import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { stepUpActionHash, type AuthenticationResponseJSON } from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { MINUTE } from "../../src/auth/limits";
import { challengeKey, issueChallenge, issueStepUpChallenge, readChallenge, readStepUpChallenge } from "../../src/auth/passkeys/challenge";
import { LateConfirmation, createAuthRepo, revokeConfirmedIn, type AuthRepo } from "../../src/auth/repo";
import { revokeStaffSession, stepUpOptions, verifyStepUp } from "../../src/auth/staff/step-up";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, type FlowHarness } from "./flow-harness";
import { enrolKey } from "./staff-enrolment";
import { TEST_CONSOLE, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount, rolledBack } from "./staff-fixtures";
import { revokeConfirmed, revokeRequest, signedIn, stepUpAssertion } from "./staff-step-up";

const APP_ORIGIN = "http://localhost:8081";
const NO_UV: SoftFlags = { up: true, uv: false, be: false, bs: false };
const SYNCABLE: SoftFlags = { up: true, uv: true, be: true, bs: false };
const SYNCED: SoftFlags = { up: true, uv: true, be: true, bs: true };
/** BS without BE: no authenticator may report it, and the library refuses it as malformed before the flow sees its flags. */
const BACKED_UP_ONLY: SoftFlags = { up: true, uv: true, be: false, bs: true };

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

/** The three members of an assertion the audit row stores. */
const stored = (response: AuthenticationResponseJSON) => ({
  authenticatorData: response.response.authenticatorData,
  clientDataJSON: response.response.clientDataJSON,
  signature: response.response.signature,
});

/**
 * The staff step-up through the auth module's flows on the real database (3a design, section 7, Step-up): the console at
 * http://console.localhost:8090 with the relying party console.localhost, the software authenticator, keys enrolled
 * through the enrolment flow and sessions opened by the sign-in flow. 3a's one confirmed action revokes a staff session.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff step-up", () => {
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
  const ctxOf = (h: FlowHarness) => ({ ...h.ctx, requestId: `req-${randomUUID()}` });
  const head = async () => (await migrateDb.select().from(auditHead))[0]!;
  const keyRow = async (id: string) => (await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, id)))[0]!;
  const sessionRow = async (handle: string) => (await migrateDb.select().from(staffSessions).where(eq(staffSessions.handle, handle)))[0]!;
  const rowsAfter = (seq: number) => migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, seq)).orderBy(asc(auditLog.chainSeq));
  const eventsOf = (userId: string, type: "staff_session_revoked" | "staff_key_counter_regression") =>
    migrateDb
      .select({ metadata: authEvents.metadata, ipHash: authEvents.ipHash })
      .from(authEvents)
      .where(and(eq(authEvents.userId, userId), eq(authEvents.type, type)))
      .orderBy(asc(authEvents.id));

  /**
   * A live staff account holding one key enrolled through the flow, signed in twice with it: from session `a` the person
   * confirms, and `b` is the session they revoke.
   */
  async function twoSessions(h: FlowHarness) {
    const { user } = await newStaffAccount(authDb, repo);
    const auth = new SoftAuthenticator();
    const enrolled = await enrolKey(h, auth, (await issueEnrolment(migrateDb, user.id)).token);
    const a = await signedIn(h, auth, enrolled.credentialId, 1);
    const b = await signedIn(h, auth, enrolled.credentialId, 2);
    return { user, auth, keyId: enrolled.key.id, credentialId: enrolled.credentialId, a: a.session, b: b.session };
  }

  test("the options: the session's key alone, user verification required, the console's relying party, a 5-minute prompt and a step-up challenge bound to the session and the action", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const { options } = await stepUpOptions(h.deps, s.a, request);
    expect(options.rpId).toBe(TEST_CONSOLE_RP_ID);
    expect(options.allowCredentials).toEqual([{ id: s.credentialId, type: "public-key", transports: ["usb", "nfc"] }]);
    expect(options.userVerification).toBe("required");
    expect(options.timeout).toBe(5 * MINUTE);
    const key = challengeKey(h.deps.config.authHmacKey);
    const actionHash = await stepUpActionHash(request);
    const otherTarget = await stepUpActionHash(revokeRequest(s.a.handle));
    expect(() => readStepUpChallenge(key, options.challenge, h.clock.now(), s.a.handle, actionHash)).not.toThrow();
    // Bound to this session and this action: another session's handle or another target refuses it, as does every other ceremony.
    expect(() => readStepUpChallenge(key, options.challenge, h.clock.now(), s.b.handle, actionHash)).toThrow(AuthError);
    expect(() => readStepUpChallenge(key, options.challenge, h.clock.now(), s.a.handle, otherTarget)).toThrow(AuthError);
    expect(() => readChallenge(key, options.challenge, "staff_signin", h.clock.now())).toThrow(AuthError);
  });

  test("a confirmed revocation: the session revoked, the key's use recorded, staff_session_revoked and its audit row with the action's hash, params, key and assertion, last in one transaction; no mail", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    h.mailer.sent.length = 0;
    const before = await head();
    h.clock.advance(MINUTE);
    const now = h.clock.now();
    const { stepUp, confirmed, revoked, requestId } = await revokeConfirmed(h, s.auth, s.credentialId, s.a, s.b.handle, 3);
    expect(revoked).toBe(true);

    const actionHash = await stepUpActionHash(revokeRequest(s.b.handle));
    expect(confirmed).toEqual({
      action: "staff_session_revoked",
      target: { type: "staff_session", id: s.b.handle },
      params: {},
      actionHash,
      keyId: s.keyId,
      assertion: stored(stepUp),
      // The challenge's own expiry, by which the row must be in the chain.
      expiresAt: new Date(now.getTime() + 10 * MINUTE),
    });
    expect((await sessionRow(s.b.handle)).revokedAt).toEqual(now);
    expect((await sessionRow(s.a.handle)).revokedAt).toBeNull();
    expect(await keyRow(s.keyId)).toMatchObject({ counter: 3, lastUsedAt: now, revokedAt: null, suspectAt: null });

    // The event names the session revoked and the one that revoked it; the row the account, both sessions and the key,
    // with what audit-verify checks: the action's hash, the params and the assertion exactly as the browser sent it.
    expect(await eventsOf(s.user.id, "staff_session_revoked")).toEqual([{ metadata: { handle: s.b.handle, by: s.a.handle }, ipHash: h.ctx.ipHash }]);
    const written = await rowsAfter(before.seq);
    expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.staffSession, r.keyId, r.actionHash, r.stepUp, r.metadata, r.requestId])).toEqual([
      ["staff_session_revoked", s.user.id, "staff_session", s.b.handle, s.a.handle, s.keyId, actionHash, stored(stepUp), { params: {} }, requestId],
    ]);
    // One transaction: the revoked session, the event and the audit row, which its last statement wrote.
    const [rows] = await migrateDb.execute<{ session: string; event: string; audit: string; sessionCmin: string; eventCmin: string; auditCmin: string }>(sql`select
      (select xmin::text from auth.staff_sessions where handle = ${s.b.handle}) as session,
      (select xmin::text from auth.auth_events where user_id = ${s.user.id} and type = 'staff_session_revoked') as event,
      (select xmin::text from public.audit_log where id = ${written[0]!.id}) as audit,
      (select cmin::text from auth.staff_sessions where handle = ${s.b.handle}) as "sessionCmin",
      (select cmin::text from auth.auth_events where user_id = ${s.user.id} and type = 'staff_session_revoked') as "eventCmin",
      (select cmin::text from public.audit_log where id = ${written[0]!.id}) as "auditCmin"`);
    expect(new Set([rows!.session, rows!.event, rows!.audit]).size).toBe(1);
    expect(Number(rows!.auditCmin)).toBeGreaterThan(Math.max(Number(rows!.sessionCmin), Number(rows!.eventCmin)));
    // The person did it themselves, with their key: nobody is mailed.
    expect(h.mailer.sent).toEqual([]);
  });

  test("bound to its action and target: an assertion given to revoke one session confirms no other revocation, nor the same one from another session", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const c = await signedIn(h, s.auth, s.credentialId, 3);
    const forB = await stepUpAssertion(h, s.auth, s.credentialId, s.a, revokeRequest(s.b.handle), { counter: 4 });
    for (const [label, session, handle] of [
      ["another target", s.a, c.session.handle],
      ["another session", c.session, s.b.handle],
    ] as const) {
      const err = await failure(verifyStepUp(h.deps, session, revokeRequest(handle), forB, ctxOf(h)));
      expect([label, err.code, err.status]).toEqual([label, "staff_step_up_invalid", 403]);
    }
    expect((await sessionRow(c.session.handle)).revokedAt).toBeNull();
    expect((await keyRow(s.keyId)).counter).toBe(3);
    // Refused on its binding, before it was spent: it still confirms what it was given for, and only that.
    const confirmed = await verifyStepUp(h.deps, s.a, revokeRequest(s.b.handle), forB, ctxOf(h));
    expect(await revokeStaffSession(h.deps, s.a, confirmed, ctxOf(h))).toBe(true);
    expect((await sessionRow(s.b.handle)).revokedAt).not.toBeNull();
    expect((await sessionRow(c.session.handle)).revokedAt).toBeNull();
  });

  test("single use: a confirmation is spent by its first use, and of two at once exactly one passes", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const once = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
    await verifyStepUp(h.deps, s.a, request, once, ctxOf(h));
    const again = await failure(verifyStepUp(h.deps, s.a, request, once, ctxOf(h)));
    expect([again.code, again.status]).toEqual(["staff_step_up_invalid", 403]);

    const twice = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 4 });
    const results = await Promise.allSettled([verifyStepUp(h.deps, s.a, request, twice, ctxOf(h)), verifyStepUp(h.deps, s.a, request, twice, ctxOf(h))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.map((r) => (r.reason as AuthError).code)).toEqual(["staff_step_up_invalid"]);
  });

  test("a confirmation read with less than a minute of its ten left is challenge_expired and confirms nothing, so its row is never written after its expiry", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    for (const age of [9 * MINUTE, 10 * MINUTE]) {
      const late = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
      h.clock.advance(age);
      const err = await failure(verifyStepUp(h.deps, s.a, request, late, ctxOf(h)));
      expect([age, err.code, err.status]).toEqual([age, "challenge_expired", 400]);
    }
    expect((await keyRow(s.keyId)).counter).toBe(2);
    expect((await sessionRow(s.b.handle)).revokedAt).toBeNull();
  });

  test("a confirmation whose challenge has expired by the database's clock when its transaction opens is challenge_expired before any statement runs, and nothing is revoked or written", { timeout: 30_000 }, async () => {
    // The API's clock is ten minutes behind, so the challenge is read with all its life left, but by the database's clock,
    // which stamps the row, it expired two seconds ago: the lock bound finds nothing left, and the transaction stops there.
    // audit-verify would refuse a row written now for good.
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    h.clock.advance(-(10 * MINUTE + 2_000));
    const at = (await head()).seq;
    const stepUp = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
    const confirmed = await verifyStepUp(h.deps, s.a, request, stepUp, ctxOf(h));
    const err = await failure(revokeStaffSession(h.deps, s.a, confirmed, ctxOf(h)));
    expect([err.code, err.status]).toEqual(["challenge_expired", 400]);
    expect((await sessionRow(s.b.handle)).revokedAt).toBeNull();
    expect(await eventsOf(s.user.id, "staff_session_revoked")).toEqual([]);
    expect(await rowsAfter(at)).toEqual([]);
  });

  test("the statement that writes a confirmed row checks the database's clock: a row that joined the chain at or after its challenge's expiry is undone with everything before it", { timeout: 30_000 }, async () => {
    // The revocation's statements without the lock bound that opens their transaction, as if each wait had ended just
    // inside it and the waits together had outlasted the challenge, which expired two seconds ago by the database's clock.
    // Only the check in the audit row's own statement is left to stop the row. Each run is a savepoint, as
    // revokeConfirmedStaffSession's transaction is, inside a transaction that ends in a rollback, so a row audit-verify
    // would refuse is never committed, whatever the outcome.
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    h.clock.advance(-(10 * MINUTE + 2_000));
    const at = (await head()).seq;
    const stepUp = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
    const confirmed = await verifyStepUp(h.deps, s.a, request, stepUp, ctxOf(h));
    const input = {
      userId: s.user.id,
      staffSession: s.a.handle,
      keyId: confirmed.keyId,
      handle: s.b.handle,
      actionHash: confirmed.actionHash,
      params: confirmed.params,
      stepUp: confirmed.assertion,
      now: h.clock.now(),
      ipHash: h.ctx.ipHash,
      requestId: `req-${randomUUID()}`,
    };
    let late: unknown;
    let afterLate: { revokedAt: Date | null; events: number } | undefined;
    let inTime: unknown;
    await rolledBack(authDb, async (tx) => {
      late = await tx.transaction((sp) => revokeConfirmedIn(sp, { ...input, expiresAt: confirmed.expiresAt })).then(
        (outcome) => outcome,
        (err: unknown) => err,
      );
      // What the late run did before its row (the session revoked, the event) went with it.
      const [session] = await tx.select({ revokedAt: staffSessions.revokedAt }).from(staffSessions).where(eq(staffSessions.handle, s.b.handle));
      const events = await tx.select({ id: authEvents.id }).from(authEvents).where(and(eq(authEvents.userId, s.user.id), eq(authEvents.type, "staff_session_revoked")));
      afterLate = { revokedAt: session!.revokedAt, events: events.length };
      // The same statements with the challenge's life still ahead write: the late row was refused for its time alone.
      inTime = await tx.transaction((sp) => revokeConfirmedIn(sp, { ...input, expiresAt: new Date(Date.now() + 10 * MINUTE) }));
    });
    expect(late).toBeInstanceOf(LateConfirmation);
    expect(afterLate).toEqual({ revokedAt: null, events: 0 });
    expect(inTime).toBe("revoked");
    expect((await sessionRow(s.b.handle)).revokedAt).toBeNull();
    expect(await eventsOf(s.user.id, "staff_session_revoked")).toEqual([]);
    expect(await rowsAfter(at)).toEqual([]);
  });

  test("a confirmation stalled by a held audit head gives up before its challenge's expiry: challenge_expired, and nothing is revoked or written", { timeout: 30_000 }, async () => {
    // Four seconds of the challenge's life left by the database's clock, while another transaction holds the head, as one
    // left open after its audit insert would: the write waits for the head only a share of what is left, never past it.
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    h.clock.advance(-(10 * MINUTE - 4_000));
    const at = (await head()).seq;
    const stepUp = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
    const confirmed = await verifyStepUp(h.deps, s.a, request, stepUp, ctxOf(h));
    let outcome: Promise<unknown> = Promise.resolve();
    let gaveUpWhileHeld = false;
    await rolledBack(migrateDb, async (tx) => {
      await tx.execute(sql`select seq from public.audit_head for update`);
      outcome = revokeStaffSession(h.deps, s.a, confirmed, ctxOf(h)).then(
        () => "written",
        (err: unknown) => err,
      );
      // Released after eight seconds at most, so a write that waits on would still end (and be caught below).
      gaveUpWhileHeld = await Promise.race([outcome.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8_000))]);
    });
    const err = await outcome;
    expect(gaveUpWhileHeld).toBe(true);
    expect(err).toBeInstanceOf(AuthError);
    expect([(err as AuthError).code, (err as AuthError).status]).toEqual(["challenge_expired", 400]);
    expect((await sessionRow(s.b.handle)).revokedAt).toBeNull();
    expect(await rowsAfter(at)).toEqual([]);
  });

  test("only the session's own key confirms: the person's other key, another account's key, and the right key for the app's origin or relying party are staff_step_up_invalid", { timeout: 60_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const red = await enrolKey(h, s.auth, (await issueEnrolment(migrateDb, s.user.id)).token, { name: "Red key" });
    const other = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const fresh = async () => (await stepUpOptions(h.deps, s.a, request)).options.challenge;
    const signedBy = async (auth: SoftAuthenticator, credentialId: string, counter: number) =>
      auth.get({ credentialId, rpId: TEST_CONSOLE_RP_ID, challenge: await fresh(), origin: h.deps.config.console!.origin, flags: { up: true, uv: true, be: false, bs: false }, counter });
    const cases: [string, AuthenticationResponseJSON][] = [
      ["the person's other key", await signedBy(s.auth, red.credentialId, 1)],
      ["another account's key", await signedBy(other.auth, other.credentialId, 5)],
      ["the app's origin", await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3, origin: APP_ORIGIN })],
      ["the app's relying party", await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 4, rpId: "localhost" })],
      ["a bad signature", badSignature(await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 5 }))],
    ];
    for (const [label, response] of cases) {
      const err = await failure(verifyStepUp(h.deps, s.a, request, response, ctxOf(h)));
      expect([label, err.code, err.status]).toEqual([label, "staff_step_up_invalid", 403]);
    }
    expect((await keyRow(s.keyId)).counter).toBe(2);
    expect((await keyRow(red.key.id)).counter).toBe(0);
    expect((await keyRow(other.keyId)).counter).toBe(2);
    expect((await sessionRow(s.b.handle)).revokedAt).toBeNull();
  });

  test("a session opened before the console moved to another address with the same relying party ID confirms nothing there: staff_step_up_invalid at the options and at the confirmation, writing nothing", { timeout: 60_000 }, async () => {
    // Opened at port 8091 with a key enrolled there; the console then moved to 8090 and kept its relying party ID, and the
    // browser's staff cookies, which no port separates, still name the session. A confirmation made at the new address
    // would be a row audit-verify refuses for good, since it judges it against the origin recorded on the key.
    const MOVED_FROM = "http://console.localhost:8091";
    const before = flowHarness(repo, { console: { origin: MOVED_FROM, rpId: TEST_CONSOLE_RP_ID } });
    const { user } = await newStaffAccount(authDb, repo);
    const auth = new SoftAuthenticator();
    const enrolled = await enrolKey(before, auth, (await issueEnrolment(migrateDb, user.id, { origin: MOVED_FROM })).token);
    const a = (await signedIn(before, auth, enrolled.credentialId, 1)).session;
    const b = (await signedIn(before, auth, enrolled.credentialId, 2)).session;
    const request = revokeRequest(b.handle);
    const moved = harness();
    const at = (await head()).seq;

    const asked = await failure(stepUpOptions(moved.deps, a, request));
    expect([asked.code, asked.status]).toEqual(["staff_step_up_invalid", 403]);
    // Options from before the move (the sealing key is the same), signed by the key at the new address.
    const challenge = (await stepUpOptions(before.deps, a, request)).options.challenge;
    const stepUp = await stepUpAssertion(moved, auth, enrolled.credentialId, a, request, { counter: 3, challenge });
    const err = await failure(verifyStepUp(moved.deps, a, request, stepUp, ctxOf(moved)));
    expect([err.code, err.status]).toEqual(["staff_step_up_invalid", 403]);
    expect((await keyRow(enrolled.key.id)).counter).toBe(2);
    expect((await sessionRow(b.handle)).revokedAt).toBeNull();
    expect(await rowsAfter(at)).toEqual([]);
  });

  test("whatever the codec or the library refuses is staff_step_up_invalid, never a passkey code", { timeout: 60_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const key = challengeKey(h.deps.config.authHmacKey);
    const now = h.clock.now();
    const actionHash = await stepUpActionHash(request);
    const assert = (challenge: string, counter: number) => stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter, challenge });
    const used = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
    await verifyStepUp(h.deps, s.a, request, used, ctxOf(h));
    const spent = JSON.parse(Buffer.from(used.response.clientDataJSON, "base64url").toString()).challenge as string;

    const cases: [string, AuthenticationResponseJSON][] = [
      ["a spent challenge", await assert(spent, 4)],
      ["a step-up challenge for another session", await assert(issueStepUpChallenge(key, now, s.b.handle, actionHash), 5)],
      ["a step-up challenge sealed with another key", await assert(issueStepUpChallenge(challengeKey(Buffer.alloc(32, 9)), now, s.a.handle, actionHash), 6)],
      ["the app's sign-in challenge", await assert(issueChallenge(key, "signin", now), 7)],
      ["the app's re-authentication challenge for this session", await assert(issueChallenge(key, "reauth", now, s.a.handle), 8)],
      ["a staff sign-in challenge", await assert(issueChallenge(key, "staff_signin", now), 9)],
      ["a staff registration challenge", await assert(issueChallenge(key, "staff_register", now, randomUUID()), 10)],
      ["a forged challenge", await assert(randomBytes(74).toString("base64url"), 11)],
      ["not a challenge at all", await assert("x", 12)],
    ];
    for (const [label, response] of cases) {
      const err = await failure(verifyStepUp(h.deps, s.a, request, response, ctxOf(h)));
      expect([label, err.code, err.status]).toEqual([label, "staff_step_up_invalid", 403]);
      expect(err.code, label).not.toMatch(/^passkey_/);
    }
    // Only the one good confirmation moved the counter.
    expect((await keyRow(s.keyId)).counter).toBe(3);
  });

  test("after the signature, the flags: no UV is staff_key_not_user_verified, BE backed up or not staff_key_not_device_bound, and BS without BE staff_step_up_invalid; none moves the counter", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const cases: [SoftFlags, string][] = [
      [NO_UV, "staff_key_not_user_verified"],
      [SYNCABLE, "staff_key_not_device_bound"],
      [SYNCED, "staff_key_not_device_bound"],
      [BACKED_UP_ONLY, "staff_step_up_invalid"],
    ];
    for (const [flags, code] of cases) {
      const response = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 5, flags });
      const err = await failure(verifyStepUp(h.deps, s.a, request, response, ctxOf(h)));
      expect([JSON.stringify(flags), err.code, err.status]).toEqual([JSON.stringify(flags), code, 403]);
    }
    expect(await keyRow(s.keyId)).toMatchObject({ counter: 2, revokedAt: null });
    // The counter the refused assertions reported is still ahead of the stored one.
    expect((await revokeConfirmed(h, s.auth, s.credentialId, s.a, s.b.handle, 5)).revoked).toBe(true);
  });

  test("a counter that goes backwards at a step-up revokes the key and every staff session it opened, the confirming one included, records it with via step_up, mails staff_key_suspect and answers staff_key_suspended", { timeout: 60_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const red = await enrolKey(h, s.auth, (await issueEnrolment(migrateDb, s.user.id)).token, { name: "Red key" });
    const onRed = await signedIn(h, s.auth, red.credentialId, 1);
    h.mailer.sent.length = 0;
    const before = await head();
    h.clock.advance(MINUTE);
    const now = h.clock.now();
    const response = await stepUpAssertion(h, s.auth, s.credentialId, s.a, revokeRequest(s.b.handle), { counter: 2 });
    const err = await failure(verifyStepUp(h.deps, s.a, revokeRequest(s.b.handle), response, ctxOf(h)));
    expect([err.code, err.status]).toEqual(["staff_key_suspended", 403]);

    expect(await keyRow(s.keyId)).toMatchObject({ revokedAt: now, suspectAt: now, counter: 2 });
    expect(await keyRow(red.key.id)).toMatchObject({ revokedAt: null, suspectAt: null });
    expect((await sessionRow(s.a.handle)).revokedAt).toEqual(now);
    expect((await sessionRow(s.b.handle)).revokedAt).toEqual(now);
    expect((await sessionRow(onRed.session.handle)).revokedAt).toBeNull();
    expect((await eventsOf(s.user.id, "staff_key_counter_regression")).map((e) => e.metadata)).toEqual([{ keyId: s.keyId, sessionsRevoked: 2, via: "step_up" }]);
    // The regression's own row, and no revocation as asked: the action never ran.
    const written = await rowsAfter(before.seq);
    expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.metadata])).toEqual([
      ["staff_key_counter_regression", s.user.id, "staff_key", s.keyId, { keyId: s.keyId, sessionsRevoked: 2, via: "step_up" }],
    ]);
    expect(h.mailer.sent).toEqual([{ to: s.user.email, template: "staff_key_suspect", data: { name: "Blue key" } }]);
  });

  test("a key revoked or an account demoted between the confirmation and the action ends there: staff_session_required, and nothing is revoked or written", { timeout: 60_000 }, async () => {
    const h = harness();
    const enders: [string, (s: Awaited<ReturnType<typeof twoSessions>>) => Promise<unknown>][] = [
      ["the key revoked", (s) => authDb.update(staffKeys).set({ revokedAt: h.clock.now() }).where(eq(staffKeys.id, s.keyId))],
      ["the account demoted", (s) => authDb.update(users).set({ role: "user" }).where(eq(users.id, s.user.id))],
      ["the account deleted", (s) => authDb.update(users).set({ deletedAt: h.clock.now() }).where(eq(users.id, s.user.id))],
    ];
    for (const [label, end] of enders) {
      const s = await twoSessions(h);
      const request = revokeRequest(s.b.handle);
      const confirmed = await verifyStepUp(h.deps, s.a, request, await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 }), ctxOf(h));
      await end(s);
      const before = await head();
      const err = await failure(revokeStaffSession(h.deps, s.a, confirmed, ctxOf(h)));
      expect([label, err.code, err.status]).toEqual([label, "staff_session_required", 401]);
      expect((await sessionRow(s.b.handle)).revokedAt, label).toBeNull();
      expect(await head(), label).toEqual(before);
    }
  });

  test("a session that is not the person's own and live is not theirs to revoke: false, and nothing is changed or written", { timeout: 60_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const other = await twoSessions(h);
    const before = await head();
    // A confirmation for another account's session verifies, since it names that handle, and revokes nothing.
    expect((await revokeConfirmed(h, s.auth, s.credentialId, s.a, other.b.handle, 3)).revoked).toBe(false);
    expect((await sessionRow(other.b.handle)).revokedAt).toBeNull();
    // Nor a handle no session has.
    expect((await revokeConfirmed(h, s.auth, s.credentialId, s.a, randomUUID(), 4)).revoked).toBe(false);
    // Nor one of the person's own that has already ended: its first end stays as it was.
    const ended = new Date(h.clock.ms() - MINUTE);
    await authDb.update(staffSessions).set({ revokedAt: ended }).where(eq(staffSessions.handle, s.b.handle));
    expect((await revokeConfirmed(h, s.auth, s.credentialId, s.a, s.b.handle, 5)).revoked).toBe(false);
    expect((await sessionRow(s.b.handle)).revokedAt).toEqual(ended);
    expect(await head()).toEqual(before);
    expect(await eventsOf(s.user.id, "staff_session_revoked")).toEqual([]);
  });
});
