import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { StaffEnrollOptionsResponse, StaffEnrollVerifyResponse } from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, passkeys, staffEnrollments, staffKeys, users, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { MINUTE } from "../../src/auth/limits";
import { challengeKey, issueChallenge, readChallenge } from "../../src/auth/passkeys/challenge";
import { registerOptions, registerVerify, signInOptions, signInVerify } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { enrollOptions, enrollVerify } from "../../src/auth/staff/enroll";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator, type CborValue, type SoftCreateInput, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";
import {
  DEVICE_BOUND,
  TEST_CONSOLE,
  TEST_CONSOLE_ORIGIN,
  TEST_CONSOLE_RP_ID,
  addStaffKey,
  issueEnrolment,
  newStaffAccount,
  withLockTimeout,
} from "./staff-fixtures";
import { enrolKey } from "./staff-enrolment";

const APP_ORIGIN = "http://localhost:8081";
const AAGUID = "ee882879-721c-4913-9775-3dfcce97072a";
const NO_UV: SoftFlags = { up: true, uv: false, be: false, bs: false };
const SYNCED: SoftFlags = { up: true, uv: true, be: true, bs: true };
const SYNCABLE: SoftFlags = { up: true, uv: true, be: true, bs: false };
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

/**
 * Staff key enrolment through the auth module's flows on the real database (3a design, section 7, Enrolment): the console
 * at http://console.localhost:8090 with the relying party console.localhost beside the app at http://localhost:8081, the
 * software authenticator, and enrolments the migrator inserts as `staff.js enroll` does.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff key enrolment", () => {
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    authDb = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    // The migrate role issues enrolments and reads every row back; the test environment carries its URL.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 4 });
    repo = createAuthRepo(authDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(migrateDb)]);
  });

  const harness = () => flowHarness(repo, { console: TEST_CONSOLE });
  const requestContext = (h: FlowHarness) => ({ ...h.ctx, requestId: `req-${randomUUID()}` });
  const keysOf = (userId: string) => migrateDb.select().from(staffKeys).where(eq(staffKeys.userId, userId)).orderBy(staffKeys.createdAt);
  const enrolmentRow = async (id: string) => (await migrateDb.select().from(staffEnrollments).where(eq(staffEnrollments.id, id)))[0];
  const head = async () => (await migrateDb.select().from(auditHead))[0]!;
  const staffEvents = (userId: string) =>
    migrateDb
      .select({ type: authEvents.type, metadata: authEvents.metadata })
      .from(authEvents)
      .where(and(eq(authEvents.userId, userId), sql`${authEvents.type}::text like 'staff_%'`))
      .orderBy(authEvents.id);

  /** The options for a link and the software authenticator's answer to them, from the console's origin unless told otherwise. */
  async function ceremony(h: FlowHarness, token: string, auth: SoftAuthenticator, overrides: Partial<SoftCreateInput> = {}, name = "Blue key") {
    const answer = await enrollOptions(h.deps, { token, name, kind: "security_key" });
    const response = auth.create({
      rpId: answer.options.rp.id!,
      challenge: answer.options.challenge,
      origin: TEST_CONSOLE_ORIGIN,
      userHandle: Buffer.from(answer.options.user.id, "base64url"),
      flags: DEVICE_BOUND,
      transports: ["usb", "nfc"],
      ...overrides,
    });
    return { answer, response };
  }

  /** A live staff account with a handle and one open enrolment link. */
  async function staffWithLink(role: "moderator" | "admin" = "moderator") {
    const account = await newStaffAccount(authDb, repo, role);
    const enrolment = await issueEnrolment(migrateDb, account.user.id);
    return { ...account, enrolment };
  }

  describe("the whole enrolment", () => {
    test("stores a user-verified, device-bound key with its enrolment's origin and relying party ID, spends the link, records it and mails the owner", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, enrolment } = await staffWithLink();
      expect((await repo.findUserById(user.id))!.webauthnUserId).toBeNull();
      const auth = new SoftAuthenticator();
      const { answer, response } = await ceremony(h, enrolment.token, auth, { aaguid: AAGUID });

      // The options (3a design, section 7): the console's relying party, the account's user handle set now and labelled with
      // the key's name, user verification and a resident key required, the pinned algorithms, no attestation, the
      // security-key hint, and a staff registration challenge bound to the enrolment.
      expect(StaffEnrollOptionsResponse.parse(answer)).toBeTruthy();
      expect(answer.rpShared).toBe(false);
      const { options } = answer;
      expect(options.rp).toEqual({ id: TEST_CONSOLE_RP_ID, name: "korbat" });
      const handle = (await repo.findUserById(user.id))!.webauthnUserId!;
      expect(handle).toHaveLength(32);
      expect(options.user).toEqual({ id: handle.toString("base64url"), name: "Blue key", displayName: "Blue key" });
      expect(options.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "required", authenticatorAttachment: "cross-platform" });
      expect(options.hints).toEqual(["security-key"]);
      expect(options.attestation).toBe("none");
      expect(options.pubKeyCredParams!.map((p) => p.alg)).toEqual([-8, -7, -257]);
      expect(options.excludeCredentials).toEqual([]);
      expect(() => readChallenge(challengeKey(h.deps.config.authHmacKey), options.challenge, "staff_register", h.clock.now(), enrolment.id)).not.toThrow();

      const before = await head();
      const ctx = requestContext(h);
      const result = await enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, ctx);
      expect(StaffEnrollVerifyResponse.parse(result)).toBeTruthy();
      const [stored] = await keysOf(user.id);
      expect(result).toEqual({ key: { id: stored!.id, name: "Blue key", createdAt: stored!.createdAt.toISOString(), lastUsedAt: null } });
      expect(stored).toMatchObject({
        credentialId: response.id,
        counter: 0,
        transports: ["usb", "nfc"],
        name: "Blue key",
        aaguid: AAGUID,
        origin: TEST_CONSOLE_ORIGIN,
        rpId: TEST_CONSOLE_RP_ID,
        lastUsedAt: null,
        revokedAt: null,
        suspectAt: null,
      });
      expect((await enrolmentRow(enrolment.id))!.usedAt).not.toBeNull();

      // The auth event and the key's audit row, written by auth.add_staff_key as the transaction's last statement.
      expect(await staffEvents(user.id)).toEqual([{ type: "staff_key_added", metadata: { enrollmentId: enrolment.id } }]);
      const rows = await migrateDb.select().from(auditLog).where(and(eq(auditLog.action, "staff_key_added"), eq(auditLog.keyId, stored!.id)));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorId: user.id, targetType: "staff_key", targetId: stored!.id, requestId: ctx.requestId, metadata: { enrollmentId: enrolment.id } });
      expect(rows[0]!.chainSeq).toBeGreaterThan(before.seq);
      // One transaction wrote the event, the key, the spent enrolment and the audit row: each carries its id in xmin.
      const [xmins] = await migrateDb.execute<{ event: string; key: string; enrolment: string; audit: string }>(sql`select
        (select xmin::text from auth.auth_events where user_id = ${user.id} and type = 'staff_key_added') as event,
        (select xmin::text from auth.staff_keys where id = ${stored!.id}) as key,
        (select xmin::text from auth.staff_enrollments where id = ${enrolment.id}) as enrolment,
        (select xmin::text from public.audit_log where id = ${rows[0]!.id}) as audit`);
      expect(new Set([xmins!.event, xmins!.key, xmins!.enrolment, xmins!.audit]).size).toBe(1);

      // The owner is told after the commit, with the key's name and the time it was registered; no link.
      expect(h.mailer.sent).toEqual([{ to: user.email, template: "staff_key_added", data: { name: "Blue key", time: mailTime(stored!.createdAt) } }]);
    });

    test("the link works once: the options and the verification both refuse it afterwards", { timeout: 30_000 }, async () => {
      const h = harness();
      const { enrolment } = await staffWithLink();
      const auth = new SoftAuthenticator();
      await enrolKey(h, auth, enrolment.token);
      const again = await failure(enrollOptions(h.deps, { token: enrolment.token, name: "Red key", kind: "security_key" }));
      expect([again.code, again.status]).toEqual(["staff_enrollment_invalid", 400]);
      // A ceremony prepared before the link was spent fails too.
      const late = issueChallenge(challengeKey(h.deps.config.authHmacKey), "staff_register", h.clock.now(), enrolment.id);
      const response = auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge: late, origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });
      expect((await failure(enrollVerify(h.deps, { token: enrolment.token, name: "Red key", response }, requestContext(h)))).code).toBe("staff_enrollment_invalid");
    });

    test("the account's user handle is kept when it has one, and \"Use Windows Hello on this computer\" sends no hint", async () => {
      const h = harness();
      const { user, enrolment } = await staffWithLink();
      const existing = randomBytes(32);
      expect(await repo.ensureWebauthnUserId(user.id, existing)).toEqual(existing);
      const { options } = await enrollOptions(h.deps, { token: enrolment.token, name: "Laptop", kind: "this_device" });
      expect(options.user).toEqual({ id: existing.toString("base64url"), name: "Laptop", displayName: "Laptop" });
      expect(options.hints).toEqual([]);
      expect(options.authenticatorSelection).toEqual({ residentKey: "required", requireResidentKey: true, userVerification: "required" });
    });
  });

  describe("keys the console refuses, the link staying usable", () => {
    test("a key that did not verify the user is staff_key_not_user_verified, and the same link then enrols a key that did", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, enrolment } = await staffWithLink();
      const before = await head();
      const { response } = await ceremony(h, enrolment.token, new SoftAuthenticator(), { flags: NO_UV });
      const err = await failure(enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, requestContext(h)));
      expect([err.code, err.status]).toEqual(["staff_key_not_user_verified", 403]);
      expect(await keysOf(user.id)).toEqual([]);
      expect((await enrolmentRow(enrolment.id))!.usedAt).toBeNull();
      expect(await staffEvents(user.id)).toEqual([]);
      expect(await head()).toEqual(before);
      expect(h.mailer.sent).toEqual([]);
      await enrolKey(h, new SoftAuthenticator(), enrolment.token);
      expect(await keysOf(user.id)).toHaveLength(1);
    });

    test("a backup-eligible key is staff_key_not_device_bound, backed up or not, and the same link then enrols a device-bound key", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, enrolment } = await staffWithLink();
      for (const flags of [SYNCABLE, SYNCED]) {
        const { response } = await ceremony(h, enrolment.token, new SoftAuthenticator(), { flags });
        const err = await failure(enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, requestContext(h)));
        expect([JSON.stringify(flags), err.code, err.status]).toEqual([JSON.stringify(flags), "staff_key_not_device_bound", 403]);
      }
      expect(await keysOf(user.id)).toEqual([]);
      await enrolKey(h, new SoftAuthenticator(), enrolment.token);
      expect(await keysOf(user.id)).toHaveLength(1);
    });

    test("whatever the codec or the wrapper refuses is staff_key_refused, never a passkey code, and the link still works", { timeout: 60_000 }, async () => {
      const h = harness();
      const { user, enrolment } = await staffWithLink();
      const other = await staffWithLink();
      const auth = new SoftAuthenticator();
      const key = challengeKey(h.deps.config.authHmacKey);
      const verify = (response: Parameters<typeof enrollVerify>[1]["response"]) => failure(enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, requestContext(h)));
      const create = (challenge: string, overrides: Partial<SoftCreateInput> = {}) =>
        auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND, ...overrides });
      const fresh = async () => (await enrollOptions(h.deps, { token: enrolment.token, name: "Blue key", kind: "security_key" })).options.challenge;

      // A spent challenge: the first answer is refused on its flags, after its challenge was spent.
      const spent = create(await fresh(), { flags: NO_UV });
      expect((await verify(spent)).code).toBe("staff_key_not_user_verified");
      const cases: [string, Parameters<typeof verify>[0]][] = [
        ["a spent challenge", spent],
        ["a personal passkey's registration challenge", create(issueChallenge(key, "register", h.clock.now(), enrolment.id))],
        ["a staff sign-in challenge", create(issueChallenge(key, "staff_signin", h.clock.now()))],
        ["a challenge bound to another enrolment", create((await enrollOptions(h.deps, { token: other.enrolment.token, name: "Blue key", kind: "security_key" })).options.challenge)],
        ["a forged challenge", create(randomBytes(58).toString("base64url"))],
        ["the app's origin", create(await fresh(), { origin: APP_ORIGIN })],
        ["the app's relying party", create(await fresh(), { rpId: "localhost" })],
        ["a self attestation whose signature does not verify", create(await fresh(), { fmt: "packed", attStmt: new Map<string | number, CborValue>([["alg", -7], ["sig", randomBytes(70)]]) })],
        ["an attestation format the wrapper does not accept", create(await fresh(), { fmt: "tpm", attStmt: new Map<string | number, CborValue>([["ver", "2.0"], ["alg", -257], ["x5c", [randomBytes(300)]], ["sig", randomBytes(70)]]) })],
      ];
      for (const [label, response] of cases) {
        const err = await verify(response);
        expect([label, err.code, err.status]).toEqual([label, "staff_key_refused", 400]);
      }
      // Client data that is not JSON never reaches the codec.
      const garbled = create(await fresh());
      expect((await verify({ ...garbled, response: { ...garbled.response, clientDataJSON: Buffer.from("not json").toString("base64url") } })).code).toBe("staff_key_refused");
      // An expired challenge keeps the shared code, which the console answers by starting over.
      const slow = create(await fresh());
      h.clock.advance(10 * MINUTE);
      expect((await verify(slow)).code).toBe("challenge_expired");

      expect(await keysOf(user.id)).toEqual([]);
      expect(h.mailer.sent).toEqual([]);
      await enrolKey(h, auth, enrolment.token);
      expect(await keysOf(user.id)).toHaveLength(1);
    });

    test("a credential id korbat already holds as a staff key is staff_key_refused, and writes nothing", { timeout: 30_000 }, async () => {
      const h = harness();
      const first = await staffWithLink();
      const auth = new SoftAuthenticator();
      const { credentialId } = await enrolKey(h, auth, first.enrolment.token);
      const second = await staffWithLink();
      const before = await head();
      const { response } = await ceremony(h, second.enrolment.token, auth, { credentialId: Buffer.from(credentialId, "base64url") });
      const err = await failure(enrollVerify(h.deps, { token: second.enrolment.token, name: "Blue key", response }, requestContext(h)));
      expect([err.code, err.status]).toEqual(["staff_key_refused", 400]);
      expect(await keysOf(second.user.id)).toEqual([]);
      expect(await staffEvents(second.user.id)).toEqual([]);
      expect(await head()).toEqual(before);
    });
  });

  describe("links that enrol nothing", () => {
    test("an unknown token, an expired link and a link recorded for another console origin or relying party are staff_enrollment_invalid at both steps", async () => {
      const h = harness();
      const account = await newStaffAccount(authDb, repo);
      const tokens = [
        ["an unknown token", randomToken()],
        ["an expired link", (await issueEnrolment(migrateDb, account.user.id, { expiresAt: new Date(Date.now() - MINUTE) })).token],
        // The console moved after the link was issued: its keys would be bound to the old address.
        ["another origin", (await issueEnrolment(migrateDb, account.user.id, { origin: "http://console.localhost:8091" })).token],
        ["another relying party", (await issueEnrolment(migrateDb, account.user.id, { rpId: "localhost" })).token],
      ] as const;
      const response = new SoftAuthenticator().create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomToken(58), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });
      for (const [label, token] of tokens) {
        const options = await failure(enrollOptions(h.deps, { token, name: "Blue key", kind: "security_key" }));
        expect([label, options.code, options.status]).toEqual([label, "staff_enrollment_invalid", 400]);
        const verify = await failure(enrollVerify(h.deps, { token, name: "Blue key", response }, requestContext(h)));
        expect([label, verify.code]).toEqual([label, "staff_enrollment_invalid"]);
      }
    });

    test("an account that is not staff, has no handle or is deleted is staff_enrollment_invalid, and its link is left unspent", async () => {
      const h = harness();
      for (const [label, change] of [
        ["demoted", { role: "user" as const }],
        ["without a handle", { onboardedAt: null }],
        ["deleted", { deletedAt: new Date() }],
      ] as const) {
        const { user, enrolment } = await staffWithLink();
        await authDb.update(users).set(change).where(eq(users.id, user.id));
        const err = await failure(enrollOptions(h.deps, { token: enrolment.token, name: "Blue key", kind: "security_key" }));
        expect([label, err.code]).toEqual([label, "staff_enrollment_invalid"]);
        expect((await enrolmentRow(enrolment.id))!.usedAt, label).toBeNull();
      }
    });

    test("the database decides last: a link that expired after the flow read it enrols nothing, as staff_enrollment_invalid", { timeout: 30_000 }, async () => {
      const h = harness();
      const account = await newStaffAccount(authDb, repo);
      // Expired by the database's clock a minute ago, still open by the flows' clock, ten minutes behind it.
      const enrolment = await issueEnrolment(migrateDb, account.user.id, { expiresAt: new Date(Date.now() - MINUTE) });
      h.clock.advance(-10 * MINUTE);
      const before = await head();
      const { response } = await ceremony(h, enrolment.token, new SoftAuthenticator());
      const err = await failure(enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, requestContext(h)));
      expect([err.code, err.status]).toEqual(["staff_enrollment_invalid", 400]);
      expect(await keysOf(account.user.id)).toEqual([]);
      expect(await staffEvents(account.user.id)).toEqual([]);
      expect(await head()).toEqual(before);
      expect(h.mailer.sent).toEqual([]);
    });

    test("a demotion that commits while the enrolment waits for the account's row enrols nothing", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, enrolment } = await staffWithLink();
      const { response } = await ceremony(h, enrolment.token, new SoftAuthenticator());
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let holding!: () => void;
      const held = new Promise<void>((resolve) => (holding = resolve));
      // What grant-role does: the account's row locked first, then the role changed, in a transaction that ends in a commit.
      const demotion = withLockTimeout(authDb, async (tx) => {
        await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("no key update");
        holding();
        await released;
        await tx.update(users).set({ role: "user" }).where(eq(users.id, user.id));
      });
      await held;
      const verifying = failure(enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, requestContext(h)));
      // Long enough for the verification to reach the account's row and wait there.
      await new Promise((resolve) => setTimeout(resolve, 500));
      release();
      await demotion;
      expect((await verifying).code).toBe("staff_enrollment_invalid");
      expect(await keysOf(user.id)).toEqual([]);
      expect((await enrolmentRow(enrolment.id))!.usedAt).toBeNull();
    });

    test("at most five live keys: a sixth from a link issued while the account held four is staff_key_limit, and a revocation frees a slot", { timeout: 60_000 }, async () => {
      const h = harness();
      const account = await newStaffAccount(authDb, repo);
      for (let i = 0; i < 4; i++) await addStaffKey(authDb, (await issueEnrolment(migrateDb, account.user.id)).token);
      // Two links issued at once, as staff.js enroll allows while the account holds four.
      const fifth = await issueEnrolment(migrateDb, account.user.id);
      const sixth = await issueEnrolment(migrateDb, account.user.id);
      const auth = new SoftAuthenticator();
      await enrolKey(h, auth, fifth.token);
      const before = await head();
      const { response } = await ceremony(h, sixth.token, auth);
      const err = await failure(enrollVerify(h.deps, { token: sixth.token, name: "Blue key", response }, requestContext(h)));
      expect([err.code, err.status]).toEqual(["staff_key_limit", 409]);
      expect(await keysOf(account.user.id)).toHaveLength(5);
      expect((await enrolmentRow(sixth.id))!.usedAt).toBeNull();
      expect(await head()).toEqual(before);
      // One key revoked, the same link enrols the fifth live key.
      const [oldest] = await keysOf(account.user.id);
      await authDb.update(staffKeys).set({ revokedAt: new Date() }).where(eq(staffKeys.id, oldest!.id));
      await enrolKey(h, auth, sixth.token);
      expect((await keysOf(account.user.id)).filter((k) => k.revokedAt === null)).toHaveLength(5);
    });
  });

  describe("relying parties", () => {
    test("while the two relying party IDs differ, the options exclude the account's live staff keys and nothing else, and 1c's options exclude no staff key", { timeout: 30_000 }, async () => {
      const h = harness();
      const account = await onboardedUser(h, repo);
      await authDb.update(users).set({ role: "moderator" }).where(eq(users.id, account.user.id));
      const [personal] = await authDb.insert(passkeys).values({ userId: account.user.id, credentialId: randomToken(), publicKey: "cose-key", name: "Phone" }).returning();
      const auth = new SoftAuthenticator();
      const live = await enrolKey(h, auth, (await issueEnrolment(migrateDb, account.user.id)).token, { transports: ["usb"] });
      const revoked = await enrolKey(h, auth, (await issueEnrolment(migrateDb, account.user.id)).token);
      await authDb.update(staffKeys).set({ revokedAt: new Date() }).where(eq(staffKeys.id, revoked.key.id));

      const answer = await enrollOptions(h.deps, { token: (await issueEnrolment(migrateDb, account.user.id)).token, name: "Red key", kind: "security_key" });
      expect(answer.rpShared).toBe(false);
      expect(answer.options.excludeCredentials).toEqual([{ id: live.credentialId, transports: ["usb"], type: "public-key" }]);
      const { options } = await registerOptions(h.deps, account.session, { label: "ada" });
      expect(options.excludeCredentials!.map((c) => c.id)).toEqual([personal!.credentialId]);
    });

    test("with both relying party IDs localhost (development), each kind's registration options exclude the other kind, and a staff key does not sign into the app", { timeout: 60_000 }, async () => {
      // The development configuration: the console at http://localhost:8090, its relying party ID the app's.
      const h = flowHarness(repo, { console: { origin: "http://localhost:8090", rpId: "localhost" } });
      const account = await onboardedUser(h, repo);
      const phone = new SoftAuthenticator();
      const personalOptions = (await registerOptions(h.deps, account.session, { label: "ada" })).options;
      const personal = phone.create({ rpId: "localhost", challenge: personalOptions.challenge, origin: APP_ORIGIN, userHandle: Buffer.from(personalOptions.user.id, "base64url"), flags: SYNCED });
      await registerVerify(h.deps, account.session, { response: personal });
      await authDb.update(users).set({ role: "moderator" }).where(eq(users.id, account.user.id));

      const enrolment = await issueEnrolment(migrateDb, account.user.id, { origin: "http://localhost:8090", rpId: "localhost" });
      const answer = await enrollOptions(h.deps, { token: enrolment.token, name: "Blue key", kind: "security_key" });
      expect(answer.rpShared).toBe(true);
      expect(answer.options.rp.id).toBe("localhost");
      // The same user handle as the personal passkey's: excluded, so the authenticator refuses rather than replacing it.
      expect(answer.options.user.id).toBe(personalOptions.user.id);
      expect(answer.options.excludeCredentials!.map((c) => c.id)).toEqual([personal.id]);
      const securityKey = new SoftAuthenticator();
      const staff = securityKey.create({ rpId: "localhost", challenge: answer.options.challenge, origin: "http://localhost:8090", userHandle: Buffer.from(answer.options.user.id, "base64url"), flags: DEVICE_BOUND });
      await enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response: staff }, requestContext(h));

      // 1c's registration options now exclude the live staff key as well.
      const again = (await registerOptions(h.deps, account.session, { label: "ada" })).options;
      expect(again.excludeCredentials!.map((c) => c.id).sort()).toEqual([personal.id, staff.id].sort());

      // The app's passkey sign-in, on the same relying party ID: only the tables refuse the staff key.
      const signin = (await signInOptions(h.deps, h.ctx)).options;
      const assertion = securityKey.get({ credentialId: staff.id, rpId: "localhost", challenge: signin.challenge, origin: APP_ORIGIN, flags: DEVICE_BOUND, counter: 1 });
      const err = await failure(signInVerify(h.deps, { deviceId: account.device.deviceId, platform: "web", response: assertion }, h.ctx));
      expect(err.code).toBe("passkey_invalid");
    });
  });
});
