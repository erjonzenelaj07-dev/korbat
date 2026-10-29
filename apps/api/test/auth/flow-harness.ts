import { randomUUID } from "node:crypto";
import type { Platform } from "@korbat/contracts";
import pino from "pino";
import type { AuthConfig, AuthDeps, RequestContext } from "../../src/auth/context";
import { parseVersionedKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import type {
  ActiveSessionRow,
  AddPasskeyOutcome,
  AuthEventType,
  AuthRepo,
  DeviceRow,
  EmailCodeRow,
  LockDownInput,
  LockDownOutcome,
  NewPasskey,
  PasskeyLimits,
  PasskeyListRow,
  PasskeyRow,
  SessionListRow,
  UserRow,
} from "../../src/auth/repo";
import { createSessions, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, type Factors, type Session } from "../../src/auth/sessions";
import { devProvider } from "../../src/auth/verify/dev";
import { MemoryMailer } from "../../src/mail/memory";

export interface RecordedEvent {
  userId: string | null;
  type: AuthEventType;
  deviceId: string | null;
  metadata: Record<string, unknown>;
}

export const TEST_TERMS = "draft-test";

/**
 * A session of a user, as the deletion and lockdown flows revoke it and, since Task 5, as the sign-in and re-authentication
 * flows issue, resolve and rotate it. The first three fields are all those older flows read; the rest let findActiveSession
 * answer a full row.
 */
export interface RecordedSession {
  id: string;
  userId: string;
  revokedAt: Date | null;
  deviceId: string;
  handle: string;
  factors: Record<string, number>;
  passkeyId: string | null;
  reauthAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface RecordedDevice {
  id: string;
  userId: string;
  revokedAt: Date | null;
  /** What the passkey flows read of the row: the platform for a passkey's default name and the label for the Security list. */
  platform: Platform;
  label: string | null;
  /** The keyed hash a sign-in looks a device up by; absent on the devices h.session and h.user seed, which no lookup finds. */
  deviceHash?: string;
}

/** A passkey of a user, as the registration writes it and the lockdown and the management flows read it. */
export type RecordedPasskey = PasskeyRow;

/**
 * The auth flows without a database: users, email codes, sessions, devices and passkeys live in memory, and the
 * repository fake holds only the methods the email-change (with its undo link), badge, deletion, not-me,
 * lockdown and TOTP confirmation flows call (and the lookups the sign-in starts make), checked against the real signatures. The key-value store and the
 * mailer are the in-memory ones; the clock moves only when a test says so, so expiries and timestamps
 * compare exactly; and events are kept as the server would write them to auth_events. The integration
 * harness (test/integration/flow-harness.ts) runs flows against the real repository instead.
 */
export function memoryFlowHarness(start = 1_789_000_000_000) {
  let t = start;
  const now = () => new Date(t);
  const users = new Map<string, UserRow>();
  const codes: EmailCodeRow[] = [];
  const events: RecordedEvent[] = [];
  const sessions: RecordedSession[] = [];
  const devices: RecordedDevice[] = [];
  const passkeys: RecordedPasskey[] = [];
  /**
   * When each event was recorded, at the harness clock, kept beside the events rather than on them: the tests compare
   * the events with the exact objects the flows write, and the daily passkey bound is the only reader of the times.
   */
  const eventTimes = new WeakMap<RecordedEvent, number>();
  const recordEvent = (event: RecordedEvent) => {
    events.push(event);
    eventTimes.set(event, t);
  };
  /** The handle of each account's profile, which the deletion flow compares the typed handle with. */
  const handles = new Map<string, string>();
  /** Repository methods told to fail: "takeDown" and "lockDown" each fail as a transaction that breaks off midway, after staging its writes and before any lands. */
  const faults = new Set<"takeDown" | "lockDown">();
  /** A device as the real row reads, from what the harness keeps of it; the hash and the times are placeholders no flow reads here. */
  const deviceRow = (device: RecordedDevice): DeviceRow => ({
    id: device.id,
    userId: device.userId,
    deviceHash: device.deviceHash ?? `hash-${device.id}`,
    label: device.label,
    platform: device.platform,
    firstSeenAt: now(),
    lastSeenAt: now(),
    ipHash: null,
    revokedAt: device.revokedAt,
  });
  /** A passkey with the label of the device that added it, as the real join answers it: null once that device is gone. */
  const withDevice = (passkey: RecordedPasskey): PasskeyListRow => ({ ...passkey, createdOn: devices.find((d) => d.id === passkey.createdDeviceId)?.label ?? null });
  /**
   * The daily bound's reading, as the real statement makes it: the times of the account's latest passkey_added events within
   * the window, at most `limit` of them, and the seconds until the oldest of those leaves the window.
   */
  const recentPasskeyAdditions = (userId: string, withinMs: number, limit: number) => {
    const recent = events
      .filter((e) => e.userId === userId && e.type === "passkey_added")
      .map((e) => eventTimes.get(e)!)
      .filter((at) => at > t - withinMs)
      .sort((a, b) => b - a)
      .slice(0, limit);
    const oldest = recent.at(-1);
    return { count: recent.length, retryAfterSeconds: oldest === undefined ? 0 : Math.ceil((oldest + withinMs - t) / 1000) };
  };
  /**
   * Step 1's rows for a user, as the real repository's takeDownRows writes them: live sessions revoked (their ids
   * returned), devices, codes and passkeys gone, and the WebAuthn user handle cleared (1c design, section 7.7).
   */
  const takeDownRows = (userId: string, at: Date): string[] => {
    const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
    for (const s of live) s.revokedAt = at;
    for (let i = devices.length - 1; i >= 0; i--) if (devices[i]!.userId === userId) devices.splice(i, 1);
    for (let i = codes.length - 1; i >= 0; i--) if (codes[i]!.userId === userId) codes.splice(i, 1);
    for (let i = passkeys.length - 1; i >= 0; i--) if (passkeys[i]!.userId === userId) passkeys.splice(i, 1);
    const row = users.get(userId);
    if (row) row.webauthnUserId = null;
    return live.map((s) => s.id);
  };
  const repo = {
    async findUserById(id: string): Promise<UserRow | undefined> {
      const row = users.get(id);
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      // As the real lookup: the address in any case, and never a deleted row.
      const row = [...users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      const row = users.get(userId);
      if (row) {
        row.failedLogins = failedLogins;
        row.lockedUntil = lockedUntil;
      }
    },
    async createEmailCode(input: Parameters<AuthRepo["createEmailCode"]>[0]): Promise<void> {
      codes.push({ id: randomUUID(), ...input, attempts: 0, consumedAt: null, createdAt: now() });
    },
    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const row = codes.find((c) => c.flowId === flowId);
      return row ? { ...row } : undefined;
    },
    async addCodeAttempt(id: string): Promise<number> {
      const row = codes.find((c) => c.id === id);
      if (!row) return Number.MAX_SAFE_INTEGER;
      row.attempts += 1;
      return row.attempts;
    },
    async consumeEmailCode(id: string, at: Date): Promise<boolean> {
      const row = codes.find((c) => c.id === id);
      if (!row || row.consumedAt !== null) return false;
      row.consumedAt = at;
      return true;
    },
    async changeEmail(userId: string, email: string, at: Date): Promise<void> {
      // As the real unique index on lower(email), deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      for (const other of users.values()) {
        if (other.id !== userId && other.email.toLowerCase() === email.toLowerCase()) {
          throw Object.assign(new Error('duplicate key value violates unique constraint "users_email_lower_idx"'), { code: "23505" });
        }
      }
      const row = users.get(userId);
      if (!row) return;
      row.email = email;
      row.emailVerifiedAt = at;
    },
    async setPasswordHash(userId: string, passwordHash: string | null, at: Date): Promise<void> {
      // As the real statement: setting or clearing a password also clears any lockout, and records when.
      const row = users.get(userId);
      if (row) Object.assign(row, { passwordHash, passwordChangedAt: at, failedLogins: 0, lockedUntil: null });
    },
    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      // As the real statement: unconditional, whatever the row held, and the last accepted step starts over.
      const row = users.get(userId);
      if (row) Object.assign(row, { totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash });
    },
    async disableTotp(userId: string): Promise<void> {
      const row = users.get(userId);
      if (row) Object.assign(row, { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    },
    async lockDown(userId: string, input: LockDownInput): Promise<LockDownOutcome> {
      // One transaction, as the real one: when it fails midway nothing it would have written lands.
      if (faults.has("lockDown")) throw new Error("the lockdown transaction failed midway and was rolled back");
      const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
      for (const s of live) s.revokedAt = input.now;
      for (const device of devices) if (device.userId === userId && device.revokedAt === null) device.revokedAt = input.now;
      // As the real statement: the user's passkeys created at or after `since`, plus any of theirs the caller names.
      const passkeysRemoved: string[] = [];
      for (let i = passkeys.length - 1; i >= 0; i--) {
        const passkey = passkeys[i]!;
        if (passkey.userId !== userId) continue;
        if (passkey.createdAt.getTime() >= input.since.getTime() || input.passkeyIds.includes(passkey.id)) {
          passkeysRemoved.push(passkey.id);
          passkeys.splice(i, 1);
        }
      }
      const row = users.get(userId);
      // As the real read of the locked row: an account that is gone has no two-factor to clear.
      const totpCleared = row !== undefined && row.deletedAt === null && row.totpEnabledAt !== null && row.totpEnabledAt.getTime() >= input.since.getTime();
      if (row) {
        // The password as setPasswordHash clears it, and two-factor as disableTotp turns it off.
        Object.assign(row, { passwordHash: null, passwordChangedAt: input.now, failedLogins: 0, lockedUntil: null });
        if (totpCleared) Object.assign(row, { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
      }
      recordEvent({ userId, type: input.event.type, deviceId: input.event.deviceId, metadata: { ...input.event.metadata, passkeysRemoved, totpCleared, passwordCleared: true } });
      return { sessionIds: live.map((s) => s.id), passkeysRemoved, totpCleared };
    },
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      // As the real partial unique index on phone_hash, deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      if (phoneHash !== null) {
        for (const other of users.values()) {
          if (other.id !== userId && other.phoneHash === phoneHash) {
            throw Object.assign(new Error('duplicate key value violates unique constraint "users_phone_hash_idx"'), { code: "23505" });
          }
        }
      }
      const row = users.get(userId);
      if (row) row.phoneHash = phoneHash;
    },
    async appendEvent(input: Parameters<AuthRepo["appendEvent"]>[0]): Promise<void> {
      recordEvent({ userId: input.userId, type: input.type, deviceId: input.deviceId ?? null, metadata: input.metadata ?? {} });
    },
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const device = devices.find((d) => d.id === id);
      return device ? deviceRow(device) : undefined;
    },
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      // As the real compare-and-set: the first candidate sticks, every later call reads it back.
      const row = users.get(userId);
      if (!row || row.deletedAt !== null) return undefined;
      row.webauthnUserId ??= candidate;
      return row.webauthnUserId;
    },
    async countPasskeys(userId: string): Promise<number> {
      return passkeys.filter((p) => p.userId === userId).length;
    },
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      // Newest first, as the real statement orders them.
      return passkeys
        .filter((p) => p.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(withDevice);
    },
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const passkey = passkeys.find((p) => p.id === id && p.userId === userId);
      return passkey ? withDevice(passkey) : undefined;
    },
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(userId, withinMs, limit);
    },
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      // As the real transaction: the account locked, both bounds checked again, then the row and its event, or nothing.
      const row = users.get(input.userId);
      if (!row || row.deletedAt !== null) return { ok: false, reason: "gone" };
      if (passkeys.filter((p) => p.userId === input.userId).length >= limits.passkeys) return { ok: false, reason: "cap" };
      const additions = recentPasskeyAdditions(input.userId, limits.windowMs, limits.additions);
      if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
      // As the real unique index on credential_id: the driver error that the flow recognises through isUniqueViolation.
      if (passkeys.some((p) => p.credentialId === input.credentialId)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint "passkeys_credential_idx"'), { code: "23505" });
      }
      const passkey: RecordedPasskey = { id: randomUUID(), lastUsedAt: null, suspectAt: null, ...input };
      passkeys.push(passkey);
      recordEvent({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey.id } });
      return { ok: true, passkey: { ...passkey } };
    },
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const passkey = passkeys.find((p) => p.id === id && p.userId === userId);
      if (!passkey) return false;
      passkey.name = name;
      return true;
    },
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const index = passkeys.findIndex((p) => p.id === id && p.userId === userId);
      if (index === -1) return undefined;
      const [removed] = passkeys.splice(index, 1);
      return { name: removed!.name };
    },
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      // As the real lookup: any account's, and the flow refuses a deleted owner through findUserById.
      const passkey = passkeys.find((p) => p.credentialId === credentialId);
      return passkey ? { ...passkey } : undefined;
    },
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const passkey = passkeys.find((p) => p.credentialId === credentialId && p.userId === userId);
      return passkey ? { ...passkey } : undefined;
    },
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, at: Date): Promise<boolean> {
      // As the real conditional update: a suspect passkey never matches, and the counter must move forward unless both are zero.
      const passkey = passkeys.find((p) => p.id === id);
      if (!passkey || passkey.suspectAt !== null) return false;
      if (!((newCounter === 0 && passkey.counter === 0) || newCounter > passkey.counter)) return false;
      passkey.counter = newCounter;
      passkey.lastUsedAt = at;
      passkey.backedUp = backedUp;
      return true;
    },
    async suspectPasskey(id: string, at: Date): Promise<void> {
      const passkey = passkeys.find((p) => p.id === id);
      if (passkey && passkey.suspectAt === null) passkey.suspectAt = at;
    },
    async findDevice(userId: string, deviceHashValue: string): Promise<DeviceRow | undefined> {
      const device = devices.find((d) => d.userId === userId && d.deviceHash === deviceHashValue && d.revokedAt === null);
      return device ? deviceRow(device) : undefined;
    },
    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const device: RecordedDevice = { id: randomUUID(), userId: input.userId, revokedAt: null, platform: input.platform as Platform, label: input.label, deviceHash: input.deviceHash };
      devices.push(device);
      return deviceRow(device);
    },
    async touchDevice(): Promise<void> {
      // The row's last-seen and ip are placeholders no flow reads here, so touching it changes nothing observable.
    },
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
      // As the real insert: the reauth time is the latest of the factors, and a fresh handle stands in for the column's default.
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      sessions.push({
        id: input.id,
        userId: input.userId,
        revokedAt: null,
        deviceId: input.deviceId,
        handle: randomUUID(),
        factors,
        passkeyId: input.passkeyId ?? null,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        createdAt: input.now,
        lastUsedAt: input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      });
    },
    async findActiveSession(id: string, at: Date): Promise<ActiveSessionRow | undefined> {
      // As the real joins: the session, its account and its device must all be live.
      const row = sessions.find((s) => s.id === id && s.revokedAt === null && s.expiresAt > at && s.absoluteExpiresAt > at);
      if (!row) return undefined;
      const user = users.get(row.userId);
      if (!user || user.deletedAt !== null) return undefined;
      const device = devices.find((d) => d.id === row.deviceId && d.revokedAt === null);
      if (!device) return undefined;
      return {
        id: row.id,
        userId: row.userId,
        deviceId: row.deviceId,
        role: user.role,
        onboardedAt: user.onboardedAt,
        totpEnabledAt: user.totpEnabledAt,
        reauthAt: row.reauthAt,
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
        handle: row.handle,
        factors: row.factors,
        passkeyId: row.passkeyId,
      };
    },
    async rotateSession(id: string, newId: string): Promise<boolean> {
      // As the real statement: the primary key changes in place for a live row, and everything else stays.
      const row = sessions.find((s) => s.id === id && s.revokedAt === null);
      if (!row) return false;
      row.id = newId;
      return true;
    },
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      // As the real statement: the kind's time is set or replaced and the reauth time follows it.
      const row = sessions.find((s) => s.id === id);
      if (!row) return;
      row.factors = { ...row.factors, [kind]: at.getTime() };
      row.reauthAt = at;
    },
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      // As the real conditional update: a step no later than the last accepted one is refused, so a code cannot be reused.
      const row = users.get(userId);
      if (!row || (row.totpLastStep !== null && row.totpLastStep >= step)) return false;
      row.totpLastStep = step;
      return true;
    },
    async revokeAllSessions(userId: string, at: Date): Promise<string[]> {
      const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
      for (const s of live) s.revokedAt = at;
      return live.map((s) => s.id);
    },
    async listActiveSessions(userId: string, at: Date): Promise<SessionListRow[]> {
      // As the real statement: the user's sessions that are neither revoked nor expired, most recently used first, each with its device's label.
      return sessions
        .filter((s) => s.userId === userId && s.revokedAt === null && s.expiresAt > at && s.absoluteExpiresAt > at)
        .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
        .map((s) => {
          const device = devices.find((d) => d.id === s.deviceId);
          return { id: s.id, handle: s.handle, deviceLabel: device?.label ?? null, platform: device?.platform ?? "web", createdAt: s.createdAt, lastUsedAt: s.lastUsedAt };
        });
    },
    async markDeleted(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
    },
    async takeDown(userId: string, at: Date, deviceId: string | null): Promise<string[]> {
      // One transaction, as the real one: when it fails midway nothing it would have written lands.
      if (faults.has("takeDown")) throw new Error("the take-down transaction failed midway and was rolled back");
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
      const revoked = takeDownRows(userId, at);
      recordEvent({ userId, type: "account_deleted", deviceId, metadata: {} });
      return revoked;
    },
    async finishTakeDown(userId: string, at: Date): Promise<string[]> {
      // As the real statement: only a row marked deleted and not purged yet.
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return [];
      return takeDownRows(userId, at);
    },
    // 3f: no address is held in this fake, so a deleted row is always purged.
    async finishPurge(userId: string, at: Date): Promise<"purged" | "held" | "none"> {
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return "none";
      Object.assign(row, {
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
        purgedAt: at,
      });
      return "purged";
    },
    // 3f: what the deletion mail reads of a held address; this fake holds none.
    async addressHold(): Promise<{ until: Date; final: boolean; told: boolean } | null> {
      return null;
    },
  } satisfies Pick<
    AuthRepo,
    | "findUserById"
    | "findUserByEmail"
    | "setPasswordFailures"
    | "createEmailCode"
    | "findEmailCode"
    | "addCodeAttempt"
    | "consumeEmailCode"
    | "changeEmail"
    | "setPasswordHash"
    | "enableTotp"
    | "disableTotp"
    | "lockDown"
    | "setPhoneHash"
    | "appendEvent"
    | "findDeviceById"
    | "ensureWebauthnUserId"
    | "countPasskeys"
    | "listPasskeys"
    | "findPasskey"
    | "recentPasskeyAdditions"
    | "addPasskey"
    | "renamePasskey"
    | "deletePasskey"
    | "findPasskeyByCredentialId"
    | "findPasskeyByCredential"
    | "claimPasskeyUse"
    | "suspectPasskey"
    | "findDevice"
    | "createDevice"
    | "touchDevice"
    | "createSession"
    | "findActiveSession"
    | "rotateSession"
    | "writeFactor"
    | "claimTotpStep"
    | "revokeAllSessions"
    | "listActiveSessions"
    | "markDeleted"
    | "takeDown"
    | "finishTakeDown"
    | "finishPurge"
    | "addressHold"
  >;
  const authRepo = repo as unknown as AuthRepo;
  const kv = new MemoryKv(() => t);
  const mailer = new MemoryMailer();
  /** profiles.verified_at by account, as the badge flows set and clear it through the profile store. */
  const verified = new Map<string, Date | null>();
  /** 3e: the accounts whose suspension runs, as the profile store's predicate would read them; a test adds to it. */
  const suspended = new Set<string>();
  const config: AuthConfig = {
    appOrigin: "http://localhost:8081",
    allowedOrigins: ["http://localhost:8081"],
    authHmacKey: Buffer.alloc(32, 3),
    ipHashKey: Buffer.alloc(32, 4),
    totpKey: parseVersionedKey(`v1:${Buffer.alloc(32, 5).toString("base64")}`),
    totpPreviousKeys: [],
    notifierKey: parseVersionedKey(`v1:${Buffer.alloc(32, 6).toString("base64")}`),
    notifierPreviousKeys: [],
    termsVersion: TEST_TERMS,
    trustProxy: "none",
    verifyProvider: "dev",
    webauthn: { rpId: "localhost", rpName: "korbat", origins: ["http://localhost:8081"] },
    // The staff console is off: no flow this harness runs reaches it.
    console: null,
    homeState: null,
    contactPoint: null,
    // 3f Task 5: the report hold, on as by default.
    reportHold: true,
    // 3d Task 5: no keeper's address, so the head's daily mail is not sent from a flow.
    keeperMail: null,
  };
  const deps: AuthDeps = {
    repo: authRepo,
    kv,
    sessions: createSessions({ repo: authRepo, kv, now }),
    lockout: createLockout({ repo: authRepo, kv, now }),
    mailer,
    turnstile: { verify: async () => true },
    breachChecker: { isBreached: async () => false },
    // The flows this harness runs create no profile; the badge flows only set and clear verified_at, kept above by
    // account, and the deletion flow reads the handle, kept by account as `user` registers it. No flow here changes the
    // Explore switch or (2d) the link-preview switch, which read as the columns' defaults.
    profiles: {
      create: async () => {
        throw new Error("the memory harness has no profile store");
      },
      find: async (id) => {
        const handle = handles.get(id);
        return handle === undefined ? null : { id, handle, displayName: handle, handleChangedAt: null, verified: (verified.get(id) ?? null) !== null, showInExplore: true, sharePreviews: false };
      },
      // 3e: setting the badge is refused while the account's suspension runs, as the predicate refuses the real write.
      setVerified: async (id, at) => {
        if (at !== null && suspended.has(id)) return false;
        verified.set(id, at);
        return true;
      },
      suspended: async (id) => suspended.has(id),
    },
    // The development provider, which accepts exactly 000000; a test swaps it for null or a scripted one.
    verify: devProvider(),
    config,
    log: pino({ level: "silent" }),
    now,
  };
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: undefined };
  /**
   * A live session on a device of its own, both recorded as the deletion flow will find them. It proved an email code
   * just now unless given other factors, as a session behind requireFreshAuth has, and started from no passkey unless told so.
   * The device is a web browser labelled as the sign-in labels one, unless the test says otherwise.
   */
  const session = (userId: string, options: { factors?: Factors; passkeyId?: string | null; platform?: Platform; label?: string | null } = {}): Session => {
    const s: Session = {
      sessionId: sha256Hex(randomToken()),
      userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: now(),
      handle: randomUUID(),
      factors: options.factors ?? { email: t },
      passkeyId: options.passkeyId ?? null,
    };
    sessions.push({
      id: s.sessionId,
      userId,
      revokedAt: null,
      deviceId: s.deviceId,
      handle: s.handle,
      factors: s.factors,
      passkeyId: s.passkeyId,
      reauthAt: s.reauthAt,
      createdAt: now(),
      lastUsedAt: now(),
      expiresAt: new Date(t + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(t + SESSION_ABSOLUTE_MS),
    });
    devices.push({ id: s.deviceId, userId, revokedAt: null, platform: options.platform ?? "web", label: options.label === undefined ? "Chrome on Windows" : options.label });
    return s;
  };
  return {
    deps,
    kv,
    mailer,
    ctx,
    users,
    codes,
    events,
    sessions,
    devices,
    passkeys,
    verified,
    suspended,
    faults,
    now,
    advance(ms: number) {
      t += ms;
    },
    /** Another session of an existing account, on another device. */
    session,
    /**
     * A passkey of an existing account, created at `createdAt` (now unless given) with the row's defaults (a plain,
     * unnamed synced key added from no device) unless overridden; answers its id.
     */
    passkey(userId: string, createdAt: Date = now(), overrides: Partial<Omit<RecordedPasskey, "id" | "userId" | "createdAt">> = {}): string {
      const id = randomUUID();
      passkeys.push({
        id,
        userId,
        createdAt,
        credentialId: randomToken(),
        publicKey: "cose-key",
        counter: 0,
        transports: [],
        backedUp: false,
        name: "Passkey",
        lastUsedAt: null,
        aaguid: null,
        backupEligible: false,
        uvInitialized: false,
        createdDeviceId: null,
        suspectAt: null,
        ...overrides,
      });
      return id;
    },
    /**
     * An onboarded account holding a verified address, with a session that just proved a credential, as a route
     * behind requireFreshAuth passes it on. Its profile's handle is the address's local part unless given.
     */
    user(email: string, handle: string = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9_]/g, "_")): { user: UserRow; session: Session } {
      const id = randomUUID();
      const user: UserRow = {
        id,
        email,
        emailVerifiedAt: now(),
        phoneHash: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
        failedLogins: 0,
        lockedUntil: null,
        createdAt: now(),
        deletedAt: null,
        role: "user",
        ageConfirmedAt: now(),
        termsVersion: TEST_TERMS,
        termsAcceptedAt: now(),
        onboardedAt: now(),
        passwordChangedAt: null,
        totpLastStep: null,
        purgedAt: null,
        webauthnUserId: null,
      };
      users.set(id, user);
      handles.set(id, handle);
      return { user, session: session(id) };
    },
  };
}

export type MemoryFlowHarness = ReturnType<typeof memoryFlowHarness>;
