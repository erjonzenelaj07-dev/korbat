import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, StaffEnrollOptionsResponse, StaffEnrollVerifyResponse, type RegistrationResponseJSON } from "@korbat/contracts";
import { auditLog, closeDb, createDb, staffKeys, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { challengeKey, issueChallenge } from "../../src/auth/passkeys/challenge";
import type { PublicKeyCredentialCreationOptionsJSON } from "../../src/auth/passkeys/webauthn";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { decodeKey } from "../../src/auth/crypto";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator, type CborValue, type SoftCreateInput } from "../auth/soft-authenticator";
import { Browser } from "./http-client";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";

/**
 * The enrolment routes over HTTP (3a design, sections 7 and 12): the console's own browser on http://console.localhost:8090,
 * through the staff gate to the auth module's flows. Every refusal answers a staff code, never a passkey_* one, and no
 * answer carries CORS headers.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the enrolment routes over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let mailer: MemoryMailer;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    mailer = new MemoryMailer();
    const auth = createAuth({ config, logger, authDb, kv: new MemoryKv(), mailer, profiles: createProfileStore(apiDb) });
    const staff = createStaff({ apiDb, auth: auth.forStaff });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** The console's page: its own host and origin, echoing the staff CSRF cookie in the staff CSRF header. */
  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: "__Host-korbat_staff_csrf", csrfHeader: "x-staff-csrf" });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;

  /** The options for a link over HTTP, parsed as the console parses them. */
  async function options(b: Browser, token: string, kind: "security_key" | "this_device" = "security_key") {
    const res = await b.fetch("/api/staff/enroll/options", { json: { token, name: "Blue key", kind } });
    expect(res.status, await res.clone().text()).toBe(200);
    const answer = StaffEnrollOptionsResponse.parse(await res.json());
    // The contract checks the challenge alone and passes the rest to the browser's library, which knows its shape.
    return { rpShared: answer.rpShared, options: answer.options as unknown as PublicKeyCredentialCreationOptionsJSON };
  }

  const verify = (b: Browser, token: string, response: RegistrationResponseJSON) => b.fetch("/api/staff/enroll/verify", { json: { token, name: "Blue key", response } });

  test("a whole enrolment from the console's page: the options, the verification, the stored key and its mail", { timeout: 30_000 }, async () => {
    const { user } = await newStaffAccount(authDb, repo);
    const enrolment = await issueEnrolment(migrateDb, user.id);
    const b = consoleBrowser();
    const answer = await options(b, enrolment.token);
    expect(answer.rpShared).toBe(false);
    expect(answer.options.rp.id).toBe(TEST_CONSOLE_RP_ID);
    const response = new SoftAuthenticator().create({
      rpId: TEST_CONSOLE_RP_ID,
      challenge: answer.options.challenge,
      origin: TEST_CONSOLE_ORIGIN,
      userHandle: Buffer.from(answer.options.user.id, "base64url"),
      flags: DEVICE_BOUND,
      transports: ["usb"],
    });
    const res = await verify(b, enrolment.token, response);
    expect(res.status, await res.clone().text()).toBe(200);
    expect([...res.headers.keys()].filter((name) => name.startsWith("access-control-"))).toEqual([]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { key } = StaffEnrollVerifyResponse.parse(await res.json());
    const [stored] = await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, key.id));
    expect(stored).toMatchObject({ userId: user.id, name: "Blue key", credentialId: response.id, origin: TEST_CONSOLE_ORIGIN, rpId: TEST_CONSOLE_RP_ID });
    // The key's audit row carries the request's id, which the access log carries too.
    const [row] = await migrateDb.select().from(auditLog).where(eq(auditLog.keyId, key.id));
    expect(row!.requestId).toBe(res.headers.get("x-request-id"));
    expect(mailer.sent.filter((m) => m.to === user.email).map((m) => m.template)).toEqual(["staff_key_added"]);
  });

  test("a spent challenge, one of another purpose, one bound to another enrolment and a bad signature are each staff_key_refused, never a passkey code, and the link still works", { timeout: 60_000 }, async () => {
    const { user } = await newStaffAccount(authDb, repo);
    const enrolment = await issueEnrolment(migrateDb, user.id);
    const other = await newStaffAccount(authDb, repo);
    const otherEnrolment = await issueEnrolment(migrateDb, other.user.id);
    const b = consoleBrowser();
    const auth = new SoftAuthenticator();
    const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
    const create = (challenge: string, overrides: Partial<SoftCreateInput> = {}) =>
      auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND, ...overrides });

    // The first answer is refused on its flags, after its challenge was spent.
    const spent = create((await options(b, enrolment.token)).options.challenge, { flags: { up: true, uv: false, be: false, bs: false } });
    const first = await verify(b, enrolment.token, spent);
    expect([first.status, (await error(first)).code]).toEqual([403, "staff_key_not_user_verified"]);

    const cases: [string, RegistrationResponseJSON][] = [
      ["a spent challenge", spent],
      ["a staff sign-in challenge", create(issueChallenge(key, "staff_signin", new Date()))],
      ["a personal passkey's registration challenge", create(issueChallenge(key, "register", new Date(), enrolment.id))],
      ["a challenge bound to another enrolment", create((await options(b, otherEnrolment.token)).options.challenge)],
      [
        "a self attestation with a bad signature",
        create((await options(b, enrolment.token)).options.challenge, { fmt: "packed", attStmt: new Map<string | number, CborValue>([["alg", -7], ["sig", randomBytes(70)]]) }),
      ],
    ];
    for (const [label, response] of cases) {
      const res = await verify(b, enrolment.token, response);
      const { code, message } = await error(res);
      expect([label, res.status, code]).toEqual([label, 400, "staff_key_refused"]);
      expect(message, label).toContain("this link still works");
      expect(code, label).not.toMatch(/^passkey_/);
    }
    // Then a good answer on the same link.
    const good = create((await options(b, enrolment.token)).options.challenge);
    expect((await verify(b, enrolment.token, good)).status).toBe(200);
  });

  test("an unknown link and a spent one are each staff_enrollment_invalid at both steps", { timeout: 30_000 }, async () => {
    const b = consoleBrowser();
    const auth = new SoftAuthenticator();
    const unknown = await b.fetch("/api/staff/enroll/options", { json: { token: randomBytes(32).toString("base64url"), name: "Blue key", kind: "this_device" } });
    expect([unknown.status, (await error(unknown)).code]).toEqual([400, "staff_enrollment_invalid"]);
    const response = auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });
    const late = await verify(b, `${randomUUID().replace(/-/g, "")}${"a".repeat(11)}`, response);
    expect([late.status, (await error(late)).code]).toEqual([400, "staff_enrollment_invalid"]);

    // A link that has enrolled a key. The second answer was made on it before the first was sent, on a challenge of its own
    // that nothing spent, so only the link being spent can refuse it.
    const { user } = await newStaffAccount(authDb, repo);
    const enrolment = await issueEnrolment(migrateDb, user.id);
    const answer = async () => {
      const { options: creation } = await options(b, enrolment.token);
      return auth.create({ rpId: TEST_CONSOLE_RP_ID, challenge: creation.challenge, origin: TEST_CONSOLE_ORIGIN, userHandle: Buffer.from(creation.user.id, "base64url"), flags: DEVICE_BOUND });
    };
    const first = await answer();
    const second = await answer();
    const enrolled = await verify(b, enrolment.token, first);
    expect(enrolled.status, await enrolled.clone().text()).toBe(200);
    const again = await b.fetch("/api/staff/enroll/options", { json: { token: enrolment.token, name: "Blue key", kind: "security_key" } });
    expect([again.status, (await error(again)).code]).toEqual([400, "staff_enrollment_invalid"]);
    const spent = await verify(b, enrolment.token, second);
    expect([spent.status, (await error(spent)).code]).toEqual([400, "staff_enrollment_invalid"]);
    expect(await migrateDb.select({ id: staffKeys.id }).from(staffKeys).where(eq(staffKeys.userId, user.id))).toHaveLength(1);
  });
});
