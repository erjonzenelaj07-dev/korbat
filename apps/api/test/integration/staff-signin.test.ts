import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { StaffMe, type AuthenticationResponseJSON } from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, passkeys, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { challengeKey, issueChallenge, readChallenge } from "../../src/auth/passkeys/challenge";
import { registerOptions, registerVerify, signInOptions as passkeySignInOptions, signInVerify as passkeySignInVerify } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { STAFF_ABSOLUTE_MS, STAFF_IDLE_MS } from "../../src/auth/staff/sessions";
import { STAFF_SIGNIN_PER_IP_PER_HOUR, STAFF_SIGNIN_PER_KEY_PER_HOUR, signInOptions, signInVerify } from "../../src/auth/staff/signin";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";
import { DEVICE_BOUND, TEST_CONSOLE, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";
import { enrolKey } from "./staff-enrolment";
import { signInKey, staffAssertion } from "./staff-sign-in";

const APP_ORIGIN = "http://localhost:8081";
const NO_UV: SoftFlags = { up: true, uv: false, be: false, bs: false };
const SYNCABLE: SoftFlags = { up: true, uv: true, be: true, bs: false };
const SYNCED: SoftFlags = { up: true, uv: true, be: true, bs: true };
/** BS without BE: no authenticator may report it (WebAuthn L3, section 6.1.3), and the library refuses it with the signature. */
const BACKED_UP_ONLY: SoftFlags = { up: true, uv: true, be: false, bs: true };
/** A time as the staff mails print it, as 1c's mails do: the date and the minute in UTC. */
const mailTime = (at: Date) => `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)} UTC`;

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/** A response's signature with its last byte changed: the library's check fails, and nothing else about it does. */
function badSignature(response: AuthenticationResponseJSON): AuthenticationResponseJSON {
  const signature = Buffer.from(response.response.signature, "base64url");
  signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
  return { ...response, response: { ...response.response, signature: signature.toString("base64url") } };
}

/**
 * The staff sign-in through the auth module's flows on the real database (3a design, section 7, Sign-in and A counter that
 * goes backwards): the console at http://console.localhost:8090 with the relying party console.localhost beside the app at
 * http://localhost:8081, the software authenticator, and keys enrolled through the enrolment flow.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff sign-in", () => {
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    authDb = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    // The migrate role reads every row back; the test environment carries its URL.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 4 });
    repo = createAuthRepo(authDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(migrateDb)]);
  });

  const harness = () => flowHarness(repo, { console: TEST_CONSOLE });
  const head = async () => (await migrateDb.select().from(auditHead))[0]!;
  const keyRow = async (id: string) => (await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, id)))[0]!;
  const sessionsOf = (userId: string) => migrateDb.select().from(staffSessions).where(eq(staffSessions.userId, userId)).orderBy(asc(staffSessions.createdAt));
  const staffEvents = (userId: string) =>
    migrateDb
      .select({ type: authEvents.type, metadata: authEvents.metadata, ipHash: authEvents.ipHash })
      .from(authEvents)
      .where(and(eq(authEvents.userId, userId), sql`${authEvents.type}::text in ('staff_sign_in', 'staff_key_counter_regression', 'staff_key_revoked')`))
      .orderBy(asc(authEvents.id));
  const rowsAfter = (seq: number) => migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, seq)).orderBy(asc(auditLog.chainSeq));

  /** A live staff account with a handle (in the harness's profiles) holding one key enrolled through the flow. */
  async function staffWithKey(h: FlowHarness, name = "Blue key") {
    const { user } = await newStaffAccount(authDb, repo);
    const handle = `s_${randomUUID().slice(0, 8)}`;
    await h.deps.profiles.create({ id: user.id, handle, displayName: "Staff" });
    const auth = new SoftAuthenticator();
    const enrolled = await enrolKey(h, auth, (await issueEnrolment(migrateDb, user.id)).token, { name });
    return { user, handle, auth, keyId: enrolled.key.id, credentialId: enrolled.credentialId };
  }

  describe("a sign-in with a live staff key", () => {
    test("the options ask for a discoverable, user-verified credential of the console's relying party with a staff sign-in challenge", async () => {
      const h = harness();
      const { options } = await signInOptions(h.deps);
      expect(options.rpId).toBe(TEST_CONSOLE_RP_ID);
      expect(options.allowCredentials ?? []).toEqual([]);
      expect(options.userVerification).toBe("required");
      expect(options.timeout).toBe(5 * MINUTE);
      const key = challengeKey(h.deps.config.authHmacKey);
      expect(() => readChallenge(key, options.challenge, "staff_signin", h.clock.now())).not.toThrow();
      // Only a staff sign-in: the app's sign-in, and every other purpose, refuse it.
      expect(() => readChallenge(key, options.challenge, "signin", h.clock.now())).toThrow();
      expect(() => readChallenge(key, options.challenge, "staff_register", h.clock.now())).toThrow();
    });

    test("opens a session with its browser label, records the key's use, writes staff_sign_in and its audit row last in the session's transaction, and mails the owner after the commit", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, handle, auth, keyId, credentialId } = await staffWithKey(h);
      h.mailer.sent.length = 0;
      const before = await head();
      const now = h.clock.now();
      const { token, me, requestId } = await signInKey(h, auth, credentialId, { counter: 7 });

      // The answer is /me's: the handle, the role, the session's handle and both ends with the seconds left.
      const [session] = await sessionsOf(user.id);
      expect(StaffMe.parse(me)).toEqual({
        handle,
        role: "moderator",
        sessionHandle: session!.handle,
        idleExpiresAt: new Date(now.getTime() + STAFF_IDLE_MS).toISOString(),
        idleSecondsLeft: 15 * 60,
        absoluteExpiresAt: new Date(now.getTime() + STAFF_ABSOLUTE_MS).toISOString(),
        absoluteSecondsLeft: 12 * 60 * 60,
      });
      // The token is the cookie's value; only its sha256 is stored. The label is deviceLabel's, never the user agent.
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(session).toMatchObject({
        id: sha256Hex(token),
        userId: user.id,
        keyId,
        createdAt: now,
        lastUsedAt: now,
        idleExpiresAt: new Date(now.getTime() + 15 * MINUTE),
        absoluteExpiresAt: new Date(now.getTime() + 12 * HOUR),
        revokedAt: null,
        browser: "Chrome on Windows",
      });
      expect(await keyRow(keyId)).toMatchObject({ counter: 7, lastUsedAt: now, revokedAt: null, suspectAt: null });

      // The event names the key and the session; the audit row the account, the session and the key, with the request's id.
      expect(await staffEvents(user.id)).toEqual([{ type: "staff_sign_in", metadata: { keyId, handle: session!.handle }, ipHash: h.ctx.ipHash }]);
      const written = await rowsAfter(before.seq);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        actorId: user.id,
        action: "staff_sign_in",
        targetType: "staff_session",
        targetId: session!.handle,
        staffSession: session!.handle,
        keyId,
        actionHash: null,
        stepUp: null,
        requestId,
        metadata: {},
      });
      // One transaction: the key's use, the session, the event and the audit row carry one transaction id, the audit row
      // written by its last statement.
      const [rows] = await migrateDb.execute<{ key: string; session: string; event: string; audit: string; keyCmin: string; sessionCmin: string; eventCmin: string; auditCmin: string }>(sql`select
        (select xmin::text from auth.staff_keys where id = ${keyId}) as key,
        (select xmin::text from auth.staff_sessions where user_id = ${user.id}) as session,
        (select xmin::text from auth.auth_events where user_id = ${user.id} and type = 'staff_sign_in') as event,
        (select xmin::text from public.audit_log where id = ${written[0]!.id}) as audit,
        (select cmin::text from auth.staff_keys where id = ${keyId}) as "keyCmin",
        (select cmin::text from auth.staff_sessions where user_id = ${user.id}) as "sessionCmin",
        (select cmin::text from auth.auth_events where user_id = ${user.id} and type = 'staff_sign_in') as "eventCmin",
        (select cmin::text from public.audit_log where id = ${written[0]!.id}) as "auditCmin"`);
      expect(new Set([rows!.key, rows!.session, rows!.event, rows!.audit]).size).toBe(1);
      expect(Number(rows!.auditCmin)).toBeGreaterThan(Math.max(Number(rows!.keyCmin), Number(rows!.sessionCmin), Number(rows!.eventCmin)));

      // The owner learns of every staff session: the key's name, the browser label and the time; no link.
      expect(h.mailer.sent).toEqual([{ to: user.email, template: "staff_session_started", data: { name: "Blue key", browser: "Chrome on Windows", time: mailTime(now) } }]);
    });

    test("each sign-in is a session of its own, with the label of the browser it came from", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, auth, credentialId } = await staffWithKey(h);
      await signInKey(h, auth, credentialId, { counter: 1 });
      h.ctx.userAgent = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
      await signInKey(h, auth, credentialId, { counter: 2 });
      h.ctx.userAgent = undefined;
      await signInKey(h, auth, credentialId, { counter: 3 });
      expect((await sessionsOf(user.id)).map((s) => s.browser)).toEqual(["Chrome on Windows", "Firefox on Linux", "Browser on unknown OS"]);
    });

    test("an authenticator that always reports a zero counter signs in again and again", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, auth, credentialId } = await staffWithKey(h);
      await signInKey(h, auth, credentialId, { counter: 0 });
      await signInKey(h, auth, credentialId, { counter: 0 });
      expect(await sessionsOf(user.id)).toHaveLength(2);
    });
  });

  describe("one answer before the signature", () => {
    test("an unknown key, a revoked key, a demoted or deleted account, and a missing or wrong user handle are all staff_key_invalid, with one message, and write nothing", { timeout: 60_000 }, async () => {
      const h = harness();
      const answers: [string, AuthError][] = [];
      const attempt = async (label: string, run: Promise<unknown>) => answers.push([label, await failure(run)]);

      // A credential the authenticator holds but korbat never stored.
      const stranger = new SoftAuthenticator();
      const unknown = stranger.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });
      await attempt("an unknown key", signInKey(h, stranger, unknown.id));

      const revoked = await staffWithKey(h);
      await authDb.update(staffKeys).set({ revokedAt: new Date() }).where(eq(staffKeys.id, revoked.keyId));
      await attempt("a revoked key", signInKey(h, revoked.auth, revoked.credentialId));

      const demoted = await staffWithKey(h);
      await authDb.update(users).set({ role: "user" }).where(eq(users.id, demoted.user.id));
      await attempt("a demoted account", signInKey(h, demoted.auth, demoted.credentialId));

      const deleted = await staffWithKey(h);
      await authDb.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deleted.user.id));
      await attempt("a deleted account", signInKey(h, deleted.auth, deleted.credentialId));

      const live = await staffWithKey(h);
      await attempt("no user handle", signInKey(h, live.auth, live.credentialId, { userHandle: null }));
      await attempt("a random user handle", signInKey(h, live.auth, live.credentialId, { userHandle: randomBytes(32) }));
      const other = await staffWithKey(h);
      const otherHandle = (await repo.findUserById(other.user.id))!.webauthnUserId!;
      await attempt("another account's user handle", signInKey(h, live.auth, live.credentialId, { userHandle: otherHandle }));

      for (const [label, err] of answers) {
        expect([label, err.code, err.status, err.message]).toEqual([label, "staff_key_invalid", 401, answers[0]![1].message]);
      }
      for (const account of [revoked, demoted, deleted, live]) {
        expect(await sessionsOf(account.user.id)).toEqual([]);
        expect((await keyRow(account.keyId)).counter).toBe(0);
        expect((await keyRow(account.keyId)).lastUsedAt).toBeNull();
      }
      // The live key still opens the console with its own handle.
      expect((await signInKey(h, live.auth, live.credentialId)).me.handle).toBe(live.handle);
    });

    test("whatever the codec or the library refuses is staff_key_invalid, never a passkey code; an expired challenge is challenge_expired", { timeout: 60_000 }, async () => {
      const h = harness();
      const { user, keyId, auth, credentialId } = await staffWithKey(h);
      const key = challengeKey(h.deps.config.authHmacKey);
      const verify = (response: AuthenticationResponseJSON) => failure(signInVerify(h.deps, { response }, { ...h.ctx, requestId: `req-${randomUUID()}` }));
      const assert = (options: Parameters<typeof staffAssertion>[3] = {}) => staffAssertion(h, auth, credentialId, options);

      const used = await signInKey(h, auth, credentialId, { counter: 1 });
      const cases: [string, AuthenticationResponseJSON][] = [
        ["a spent challenge", auth.get({ credentialId, rpId: TEST_CONSOLE_RP_ID, challenge: JSON.parse(Buffer.from(used.response.response.clientDataJSON, "base64url").toString()).challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: 2 })],
        ["the app's sign-in challenge", await assert({ challenge: issueChallenge(key, "signin", h.clock.now()), counter: 3 })],
        ["a staff registration challenge", await assert({ challenge: issueChallenge(key, "staff_register", h.clock.now(), randomUUID()), counter: 4 })],
        ["a staff sign-in challenge bound to something", await assert({ challenge: issueChallenge(key, "staff_signin", h.clock.now(), randomUUID()), counter: 5 })],
        ["a forged challenge", await assert({ challenge: randomBytes(58).toString("base64url"), counter: 6 })],
        ["not a challenge at all", await assert({ challenge: "x", counter: 7 })],
        ["the app's relying party", await assert({ rpId: "localhost", counter: 8 })],
        ["the app's origin", await assert({ origin: APP_ORIGIN, counter: 9 })],
        ["a bad signature", badSignature(await assert({ counter: 10 }))],
        ["a bad signature that also reports no UV", badSignature(await assert({ counter: 11, flags: NO_UV }))],
      ];
      for (const [label, response] of cases) {
        const err = await verify(response);
        expect([label, err.code, err.status]).toEqual([label, "staff_key_invalid", 401]);
        expect(err.code, label).not.toMatch(/^passkey_/);
      }
      // None of them touched the key or opened a session; the key's counter is the one good sign-in's.
      expect((await keyRow(keyId)).counter).toBe(1);
      expect(await sessionsOf(user.id)).toHaveLength(1);

      // An expired challenge is the shared code the console answers by starting over.
      const late = await assert({ counter: 12 });
      h.clock.advance(10 * MINUTE);
      expect((await verify(late)).code).toBe("challenge_expired");
      expect((await signInKey(h, auth, credentialId, { counter: 13 })).me.role).toBe("moderator");
    });
  });

  describe("user verification and device binding, after the signature", () => {
    test("an assertion without UV is staff_key_not_user_verified, one reporting BE, backed up or not, staff_key_not_device_bound; none moves the counter or opens a session", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, keyId, auth, credentialId } = await staffWithKey(h);
      const before = await head();
      const cases: [SoftFlags, string, number][] = [
        [NO_UV, "staff_key_not_user_verified", 403],
        [SYNCABLE, "staff_key_not_device_bound", 403],
        [SYNCED, "staff_key_not_device_bound", 403],
        [BACKED_UP_ONLY, "staff_key_invalid", 401],
      ];
      for (const [flags, code, status] of cases) {
        const err = await failure(signInKey(h, auth, credentialId, { flags, counter: 5 }));
        expect([JSON.stringify(flags), err.code, err.status]).toEqual([JSON.stringify(flags), code, status]);
      }
      expect(await keyRow(keyId)).toMatchObject({ counter: 0, lastUsedAt: null, revokedAt: null });
      expect(await sessionsOf(user.id)).toEqual([]);
      expect(await head()).toEqual(before);
      // The counter the refused assertions reported is still ahead of the stored one.
      await signInKey(h, auth, credentialId, { counter: 5 });
    });
  });

  describe("a counter that goes backwards", () => {
    test("revokes the key and marks it suspect, revokes every live staff session it opened, records it last in one transaction, mails staff_key_suspect and answers staff_key_suspended", { timeout: 60_000 }, async () => {
      const h = harness();
      const { user, keyId, auth, credentialId } = await staffWithKey(h);
      const red = await enrolKey(h, auth, (await issueEnrolment(migrateDb, user.id)).token, { name: "Red key" });
      const first = await signInKey(h, auth, credentialId, { counter: 5 });
      const second = await signInKey(h, auth, credentialId, { counter: 6 });
      const onRed = await signInKey(h, auth, red.credentialId, { counter: 1 });
      // A session the key opened that has already ended stays as it was.
      const ended = new Date(h.clock.ms() - MINUTE);
      await authDb.update(staffSessions).set({ revokedAt: ended }).where(eq(staffSessions.id, sha256Hex(first.token)));
      const third = await signInKey(h, auth, credentialId, { counter: 7 });
      h.mailer.sent.length = 0;
      const before = await head();
      const now = h.clock.now();

      const err = await failure(signInKey(h, auth, credentialId, { counter: 7 }));
      expect([err.code, err.status]).toEqual(["staff_key_suspended", 403]);

      expect(await keyRow(keyId)).toMatchObject({ revokedAt: now, suspectAt: now, counter: 7 });
      expect(await keyRow(red.key.id)).toMatchObject({ revokedAt: null, suspectAt: null });
      const byId = new Map((await sessionsOf(user.id)).map((s) => [s.id, s.revokedAt]));
      expect(byId.get(sha256Hex(first.token))).toEqual(ended);
      expect(byId.get(sha256Hex(second.token))).toEqual(now);
      expect(byId.get(sha256Hex(third.token))).toEqual(now);
      expect(byId.get(sha256Hex(onRed.token))).toBeNull();
      expect(byId.size).toBe(4);

      const regression = (await staffEvents(user.id)).filter((e) => e.type === "staff_key_counter_regression");
      expect(regression.map((e) => e.metadata)).toEqual([{ keyId, sessionsRevoked: 2, via: "sign_in" }]);
      const written = await rowsAfter(before.seq);
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.keyId, r.metadata])).toEqual([
        ["staff_key_counter_regression", user.id, "staff_key", keyId, null, { keyId, sessionsRevoked: 2, via: "sign_in" }],
      ]);
      // One transaction: the key, the revoked sessions, the event and the audit row, which its last statement wrote.
      const [rows] = await migrateDb.execute<{ key: string; sessions: string; event: string; audit: string; eventCmin: string; auditCmin: string }>(sql`select
        (select xmin::text from auth.staff_keys where id = ${keyId}) as key,
        (select string_agg(distinct xmin::text, ',') from auth.staff_sessions where id in (${sha256Hex(second.token)}, ${sha256Hex(third.token)})) as sessions,
        (select xmin::text from auth.auth_events where user_id = ${user.id} and type = 'staff_key_counter_regression') as event,
        (select xmin::text from public.audit_log where id = ${written[0]!.id}) as audit,
        (select cmin::text from auth.auth_events where user_id = ${user.id} and type = 'staff_key_counter_regression') as "eventCmin",
        (select cmin::text from public.audit_log where id = ${written[0]!.id}) as "auditCmin"`);
      expect(new Set([rows!.key, rows!.sessions, rows!.event, rows!.audit]).size).toBe(1);
      expect(Number(rows!.auditCmin)).toBeGreaterThan(Number(rows!.eventCmin));

      // Never passkey_suspect, whose remedy names the app's Security screen.
      expect(h.mailer.sent).toEqual([{ to: user.email, template: "staff_key_suspect", data: { name: "Blue key" } }]);
      // The key opens nothing more, whatever counter it reports; the account's other key still does.
      expect((await failure(signInKey(h, auth, credentialId, { counter: 100 }))).code).toBe("staff_key_invalid");
      expect((await signInKey(h, auth, red.credentialId, { counter: 2 })).me.role).toBe("moderator");
    });

    test("a counter that stays at a non-zero value is a regression too", { timeout: 30_000 }, async () => {
      const h = harness();
      const { keyId, auth, credentialId } = await staffWithKey(h);
      await signInKey(h, auth, credentialId, { counter: 3 });
      expect((await failure(signInKey(h, auth, credentialId, { counter: 2 }))).code).toBe("staff_key_suspended");
      expect((await keyRow(keyId)).suspectAt).not.toBeNull();
    });
  });

  describe("limits", () => {
    test("per IP, 20 attempts an hour, counted before anything else: the 21st is rate_limited and spends no challenge", { timeout: 60_000 }, async () => {
      const h = harness();
      const { auth, credentialId } = await staffWithKey(h);
      const stranger = new SoftAuthenticator();
      const junk = stranger.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });
      for (let i = 0; i < STAFF_SIGNIN_PER_IP_PER_HOUR; i++) expect((await failure(signInKey(h, stranger, junk.id))).code).toBe("staff_key_invalid");
      const response = await staffAssertion(h, auth, credentialId);
      const limited = await failure(signInVerify(h.deps, { response }, { ...h.ctx, requestId: "req-limited" }));
      expect([limited.code, limited.status, limited.retryAfterSeconds]).toEqual(["rate_limited", 429, 3600]);
      // The same answer from another address: its challenge was never spent.
      const signed = await signInVerify(h.deps, { response }, { ...h.ctx, ipHash: randomToken(), requestId: "req-other-ip" });
      expect(signed.me.role).toBe("moderator");
      // An hour later the address may try again.
      h.clock.advance(HOUR);
      expect((await signInKey(h, auth, credentialId, { counter: 2 })).me.role).toBe("moderator");
    });

    test("per key, 10 an hour, counted only after the signature and the flags: ten unsigned answers and refused flags leave the owner able to sign in", { timeout: 90_000 }, async () => {
      const h = harness();
      const { auth, credentialId } = await staffWithKey(h);
      const elsewhere = () => randomToken();
      // Someone who knows the key's credential id but not its private key, from as many addresses as they like.
      for (let i = 0; i < STAFF_SIGNIN_PER_KEY_PER_HOUR + 2; i++) {
        const forged = badSignature(await staffAssertion(h, auth, credentialId, { counter: 50 }));
        expect((await failure(signInVerify(h.deps, { response: forged }, { ...h.ctx, ipHash: elsewhere(), requestId: `req-forged-${i}` }))).code).toBe("staff_key_invalid");
      }
      // Assertions the key really signed but that the flags refuse are not counted either.
      for (let i = 0; i < 3; i++) expect((await failure(signInKey(h, auth, credentialId, { flags: NO_UV, ipHash: elsewhere() }))).code).toBe("staff_key_not_user_verified");
      // The owner signs in ten times within the hour; the eleventh is refused.
      for (let i = 1; i <= STAFF_SIGNIN_PER_KEY_PER_HOUR; i++) await signInKey(h, auth, credentialId, { counter: i, ipHash: elsewhere() });
      const limited = await failure(signInKey(h, auth, credentialId, { counter: 11, ipHash: elsewhere() }));
      expect([limited.code, limited.status]).toEqual(["rate_limited", 429]);
      h.clock.advance(HOUR);
      await signInKey(h, auth, credentialId, { counter: 12, ipHash: elsewhere() });
    });
  });

  describe("relying parties", () => {
    test("a personal passkey's assertion made for the console's relying party is refused at the app's sign-in on the relying-party check, leaving the passkey as it was", { timeout: 30_000 }, async () => {
      // The relying parties apart, as in production: the app's localhost, the console's console.localhost.
      const h = harness();
      const account = await onboardedUser(h, repo);
      const phone = new SoftAuthenticator();
      const registration = (await registerOptions(h.deps, account.session, { label: "ada" })).options;
      // Device-bound and user-verifying, so nothing but where the assertion was made for can refuse it.
      const personal = phone.create({ rpId: "localhost", challenge: registration.challenge, origin: APP_ORIGIN, userHandle: Buffer.from(registration.user.id, "base64url"), flags: DEVICE_BOUND });
      await registerVerify(h.deps, account.session, { response: personal });
      const stored = async () => (await migrateDb.select().from(passkeys).where(eq(passkeys.credentialId, personal.id)))[0]!;
      const before = await stored();
      expect(before).toMatchObject({ counter: 0, lastUsedAt: null, suspectAt: null });
      /** The app's passkey sign-in with an assertion the phone signs for this relying party ID from this origin. */
      const passkeySignIn = async (rpId: string, origin: string, counter: number) => {
        const { options } = await passkeySignInOptions(h.deps, h.ctx);
        const response = phone.get({ credentialId: personal.id, rpId, challenge: options.challenge, origin, flags: DEVICE_BOUND, counter });
        return passkeySignInVerify(h.deps, { deviceId: account.device.deviceId, platform: "web", response }, h.ctx);
      };

      // As a browser on the console's page makes it, carrying the console's origin too, which the library checks first; then
      // from the app's own origin, which passes, so that only the relying party ID in the authenticator data can refuse it.
      for (const [label, origin] of [
        ["from the console's origin", TEST_CONSOLE_ORIGIN],
        ["from the app's origin", APP_ORIGIN],
      ] as const) {
        const err = await failure(passkeySignIn(TEST_CONSOLE_RP_ID, origin, 5));
        expect([label, err.code, err.status]).toEqual([label, "passkey_invalid", 401]);
      }
      // Refused before the passkey's use is recorded: its counter, last use and suspect mark are untouched.
      expect(await stored()).toEqual(before);
      // The same passkey, origin and counter with the app's relying party ID sign in, so the ID alone refused the one above.
      expect((await passkeySignIn("localhost", APP_ORIGIN, 5)).kind).toBe("session");
      expect((await stored()).counter).toBe(5);
    });

    test("with both relying party IDs localhost (development), a personal passkey offered at the console's sign-in is refused by the tables alone", { timeout: 60_000 }, async () => {
      // The development configuration: the console at http://localhost:8090, its relying party ID the app's.
      const h = flowHarness(repo, { console: { origin: "http://localhost:8090", rpId: "localhost" } });
      const account = await onboardedUser(h, repo);
      await h.deps.profiles.create({ id: account.user.id, handle: `s_${randomUUID().slice(0, 8)}`, displayName: "Staff" });
      const phone = new SoftAuthenticator();
      const personalOptions = (await registerOptions(h.deps, account.session, { label: "ada" })).options;
      // A device-bound, user-verifying personal passkey: its flags would pass, so only the lookup can refuse it.
      const personal = phone.create({ rpId: "localhost", challenge: personalOptions.challenge, origin: APP_ORIGIN, userHandle: Buffer.from(personalOptions.user.id, "base64url"), flags: DEVICE_BOUND });
      await registerVerify(h.deps, account.session, { response: personal });
      await authDb.update(users).set({ role: "moderator" }).where(eq(users.id, account.user.id));
      const securityKey = new SoftAuthenticator();
      const staff = await enrolKey(h, securityKey, (await issueEnrolment(migrateDb, account.user.id, { origin: "http://localhost:8090", rpId: "localhost" })).token);

      // The browser offers the personal passkey on the console's page: the right relying party, origin and user handle.
      const offered = await staffAssertion(h, phone, personal.id, { counter: 1 });
      const err = await failure(signInVerify(h.deps, { response: offered }, { ...h.ctx, requestId: "req-personal" }));
      expect([err.code, err.status]).toEqual(["staff_key_invalid", 401]);
      expect(await sessionsOf(account.user.id)).toEqual([]);
      const [stored] = await migrateDb.select().from(passkeys).where(eq(passkeys.credentialId, personal.id));
      expect(stored).toMatchObject({ counter: 0, lastUsedAt: null, suspectAt: null });
      // The account's staff key opens the console there.
      expect((await signInKey(h, securityKey, staff.credentialId)).me.role).toBe("moderator");
    });
  });
});
