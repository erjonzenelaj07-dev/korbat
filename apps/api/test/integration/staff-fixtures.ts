import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { staffEnrollments, staffSessions, users, type Db, type DbTx } from "@korbat/db";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import type { AuthRepo } from "../../src/auth/repo";
import type { SoftFlags } from "../auth/soft-authenticator";
import { newUserWithDevice } from "./auth-fixtures";

/** The first row's prev_hash, and the hash of an empty log's head. */
export const ZERO_HASH = "0".repeat(64);

/** The console the staff harness runs, beside the app at http://localhost:8081 (3a design, section 12). */
export const TEST_CONSOLE_ORIGIN = "http://console.localhost:8090";
export const TEST_CONSOLE_RP_ID = "console.localhost";
/** The console as the flow harness takes it. */
export const TEST_CONSOLE = { origin: TEST_CONSOLE_ORIGIN, rpId: TEST_CONSOLE_RP_ID };

/** What a staff key's authenticator must report (3a design, section 2): user present and verified, neither backup eligible nor backed up. */
export const DEVICE_BOUND: SoftFlags = { up: true, uv: true, be: false, bs: false };

/** The PostgreSQL error a statement ended with (drizzle wraps it as the cause), or null when it succeeded. */
export async function pgError(statement: PromiseLike<unknown>): Promise<{ message: string; code: string } | null> {
  try {
    await statement;
    return null;
  } catch (err) {
    const cause = ((err as { cause?: unknown }).cause ?? err) as { message?: unknown; code?: unknown };
    return { message: String(cause.message ?? cause), code: String(cause.code ?? "") };
  }
}

/**
 * Runs fn in a transaction whose lock waits give up after 10 seconds. An audit insert holds the chain's head until its
 * transaction ends, so a test that holds a lock must never be able to hang the run on another one.
 */
export function withLockTimeout<T>(db: Db, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    return fn(tx);
  });
}

/** The same, always rolled back: for rows no later test may see, such as a chain broken on purpose. */
export async function rolledBack(db: Db, fn: (tx: DbTx) => Promise<void>): Promise<void> {
  const rollback = new Error("rolled back on purpose");
  const outcome = await withLockTimeout(db, async (tx) => {
    await fn(tx);
    throw rollback;
  }).then(
    () => null,
    (err: unknown) => err,
  );
  if (outcome !== rollback) throw outcome;
}

/** A live staff account with a handle (onboarded), as grant-role and onboarding leave it. */
export async function newStaffAccount(authDb: Db, repo: AuthRepo, role: "moderator" | "admin" = "moderator") {
  const { user, device } = await newUserWithDevice(repo);
  await authDb.update(users).set({ role, onboardedAt: new Date() }).where(eq(users.id, user.id));
  return { user: { ...user, role }, device };
}

/**
 * An enrolment as `staff.js enroll` issues it: inserted by the migrator, the only role that may, with only the sha256 of its
 * token kept. Valid 30 minutes unless told otherwise.
 */
export async function issueEnrolment(migrateDb: Db, userId: string, options: { expiresAt?: Date; origin?: string; rpId?: string } = {}) {
  const token = randomToken();
  const [row] = await migrateDb
    .insert(staffEnrollments)
    .values({
      userId,
      tokenHash: sha256Hex(token),
      origin: options.origin ?? TEST_CONSOLE_ORIGIN,
      rpId: options.rpId ?? TEST_CONSOLE_RP_ID,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 30 * 60_000),
    })
    .returning({ id: staffEnrollments.id });
  return { id: row!.id, token };
}

export type TestStaffKey = { credentialId: string; publicKey: string; counter: number; transports: string[]; name: string; aaguid: string | null; requestId: string };

/**
 * Stores a staff key through auth.add_staff_key, as the enrolment flow's last statement will: the function spends the
 * enrolment the token names and writes the key's audit row, so it runs under a lock timeout. Its public key is a
 * placeholder; no test signs with it.
 */
export async function addStaffKey(db: Db, token: string, key: Partial<TestStaffKey> = {}) {
  const k: TestStaffKey = {
    credentialId: randomToken(16),
    publicKey: "cose-key",
    counter: 0,
    transports: ["usb", "nfc"],
    name: "Blue key",
    aaguid: randomUUID(),
    requestId: `req-${randomUUID()}`,
    ...key,
  };
  // A text[] literal such as {"usb","nfc"}: the transports are plain words, which JSON quotes as the array syntax wants.
  const transports = `{${k.transports.map((t) => JSON.stringify(t)).join(",")}}`;
  const [row] = await withLockTimeout(db, (tx) =>
    tx.execute<{ id: string }>(
      sql`select auth.add_staff_key(${token}::text, ${k.credentialId}::text, ${k.publicKey}::text, ${k.counter}::bigint, ${transports}::text[], ${k.name}::text, ${k.aaguid}::uuid, ${k.requestId}::text) as id`,
    ),
  );
  return { id: row!.id, ...k };
}

/** A staff account holding one live key, enrolled for the test console. */
export async function newStaffKey(authDb: Db, migrateDb: Db, repo: AuthRepo, role: "moderator" | "admin" = "moderator") {
  const account = await newStaffAccount(authDb, repo, role);
  const enrolment = await issueEnrolment(migrateDb, account.user.id);
  const key = await addStaffKey(authDb, enrolment.token);
  return { ...account, enrolment, key };
}

/**
 * A staff session row as Task 4's session store will write it, opened with the account's own key for 12 hours and idle
 * after 15 minutes. Inserted as the auth role, which the running API holds and which may create staff sessions.
 */
export async function newStaffSession(authDb: Db, userId: string, keyId: string, now: Date = new Date()) {
  const [row] = await authDb
    .insert(staffSessions)
    .values({
      id: sha256Hex(randomToken()),
      userId,
      keyId,
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
      browser: "Firefox on Linux",
    })
    .returning({ id: staffSessions.id, handle: staffSessions.handle });
  return row!;
}
