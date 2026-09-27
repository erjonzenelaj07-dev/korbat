import { randomBytes, randomInt, randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BadgeVerifyResponse, ErrorEnvelope, FlowResponse, MeResponse, ProfileView } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { phoneHash } from "../../src/auth/identifiers";
import { MemoryKv } from "../../src/auth/kv";
import { DEV_CODE, devProvider } from "../../src/auth/verify/dev";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial } from "../../src/social";
import { Browser } from "./http-client";

type App = ReturnType<typeof createApp>;

const newHandle = () => `b${randomBytes(4).toString("hex")}`;
/** A distinct number per use, so the per-number limit of one test never reaches another. */
const newPhone = () => `+4477${String(randomInt(10_000_000, 100_000_000))}`;

/**
 * The badge routes through the real app: 1a sign-up for the accounts, cookie sessions with CSRF, the
 * auth module's freshness check, the development provider, the real profile store (so /me and the
 * public profile read verified_at) and the unique index on the phone hash.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the verified badge over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  /** The same server with the provider off, as a korbat without an SMS account runs. */
  let appOff: App;
  const mailer = new MemoryMailer();

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const shared = { config, logger, authDb, mailer, turnstile: { verify: async () => true }, breachChecker: { isBreached: async () => false } };
    auth = createAuth({ ...shared, kv: new MemoryKv(), profiles: createProfileStore(apiDb), verify: devProvider() });
    const rateLimitStore = new MemoryStore();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), events: { append: auth.appendEvent } });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social });
    const authOff = createAuth({ ...shared, kv: new MemoryKv(), profiles: createProfileStore(apiDb) });
    appOff = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth: authOff });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in web account on the given app, onboarded unless told otherwise. */
  async function signUp(on: App = app, onboard = true) {
    const b = new Browser(on, config.APP_ORIGIN);
    const email = `badge-${randomUUID()}@korbat.local`;
    const handle = newHandle();
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (onboard) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, email, handle, userId: me.user.id };
  }

  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left, so the freshness check fails. */
  async function makeStale(b: Browser) {
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionId}`);
  }
  const eventTypes = async (userId: string) => (await auth.deps.repo.recentEvents(userId)).map((e) => e.type);
  const verifiedOnMe = async (b: Browser) => MeResponse.parse(await (await b.fetch("/api/me")).json()).profile!.verified;
  const verifiedInPublic = async (handle: string) => ProfileView.parse(await (await app.request(`/api/profiles/${handle}`)).json()).verified;
  const storedHash = async (userId: string) => (await auth.deps.repo.findUserById(userId))!.phoneHash;
  const mailsTo = (email: string) => mailer.sent.filter((m) => m.to === email).map((m) => m.template);

  /** Starts a verification for the number and returns the flow id. */
  async function start(b: Browser, phone: string) {
    const res = await b.fetch("/api/auth/badge/start", { json: { phone } });
    expect(res.status).toBe(200);
    return FlowResponse.parse(await res.json()).flowId;
  }
  const verify = (b: Browser, flowId: string, code: string) => b.fetch("/api/auth/badge/verify", { json: { flowId, code } });

  test("all three routes need an onboarded, fresh session", async () => {
    const routes = [
      ["POST", "/api/auth/badge/start", { phone: newPhone() }],
      ["POST", "/api/auth/badge/verify", { flowId: randomToken(), code: DEV_CODE }],
      ["DELETE", "/api/auth/badge", undefined],
    ] as const;
    for (const [method, path, body] of routes) {
      const anonymous = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(anonymous.status, path).toBe(401);
      expect(await errorCode(anonymous), path).toBe("unauthenticated");
    }
    const notOnboarded = await signUp(app, false);
    for (const [method, path, body] of routes) {
      const early = await notOnboarded.b.fetch(path, { method, json: body });
      expect(early.status, path).toBe(403);
      expect(await errorCode(early), path).toBe("onboarding_required");
    }
    const stale = await signUp();
    await makeStale(stale.b);
    for (const [method, path, body] of routes) {
      const refused = await stale.b.fetch(path, { method, json: body });
      expect(refused.status, path).toBe(403);
      expect(await errorCode(refused), path).toBe("reauth_required");
    }
  });

  test("the development provider end to end: a wrong code, the right one, the badge on /me and the public profile, the notices and events, then removal", async () => {
    const ada = await signUp();
    const phone = newPhone();
    const malformed = await ada.b.fetch("/api/auth/badge/start", { json: { phone: "0044 7911" } });
    expect(malformed.status).toBe(400);
    expect(await errorCode(malformed)).toBe("invalid_request");
    const flowId = await start(ada.b, phone);
    const wrong = await verify(ada.b, flowId, "123456");
    expect(wrong.status).toBe(400);
    expect(await errorCode(wrong)).toBe("invalid_code");
    expect(await verifiedOnMe(ada.b)).toBe(false);

    const right = await verify(ada.b, flowId, DEV_CODE);
    expect(right.status).toBe(200);
    expect(BadgeVerifyResponse.parse(await right.json())).toEqual({ verified: true });
    expect(await verifiedOnMe(ada.b)).toBe(true);
    expect(await verifiedInPublic(ada.handle)).toBe(true);
    expect(await storedHash(ada.userId)).toBe(phoneHash(auth.deps.config.authHmacKey, phone));
    expect(mailsTo(ada.email).at(-1)).toBe("badge_verified");
    expect(await eventTypes(ada.userId)).toContain("badge_verified");
    const replay = await verify(ada.b, flowId, DEV_CODE);
    expect(replay.status).toBe(400);
    expect(await errorCode(replay)).toBe("invalid_code");

    expect((await ada.b.fetch("/api/auth/badge", { method: "DELETE" })).status).toBe(204);
    expect(await verifiedOnMe(ada.b)).toBe(false);
    expect(await verifiedInPublic(ada.handle)).toBe(false);
    expect(await storedHash(ada.userId)).toBeNull();
    expect(mailsTo(ada.email).at(-1)).toBe("badge_removed");
    expect(await eventTypes(ada.userId)).toContain("badge_removed");
    // Removing a badge the account does not hold answers the same and tells nobody.
    const before = mailer.sent.length;
    expect((await ada.b.fetch("/api/auth/badge", { method: "DELETE" })).status).toBe(204);
    expect(mailer.sent).toHaveLength(before);
    // Nothing that left the server carries the number.
    expect(JSON.stringify(mailer.sent)).not.toContain(phone);
  });

  test("one number per account: the second account learns of the conflict only after its code, and the first keeps the badge", async () => {
    const ada = await signUp();
    const bob = await signUp();
    const phone = newPhone();
    expect((await verify(ada.b, await start(ada.b, phone), DEV_CODE)).status).toBe(200);
    // The start answers alike for a number another account holds: nothing is revealed before the code proves the phone.
    const bobFlow = await start(bob.b, phone);
    const conflict = await verify(bob.b, bobFlow, DEV_CODE);
    expect(conflict.status).toBe(409);
    expect(await errorCode(conflict)).toBe("phone_in_use");
    expect(await verifiedOnMe(ada.b)).toBe(true);
    expect(await verifiedOnMe(bob.b)).toBe(false);
    expect(await storedHash(bob.userId)).toBeNull();
    expect(await eventTypes(bob.userId)).not.toContain("badge_verified");
    // The holder can verify the same number again without conflict.
    expect((await verify(ada.b, await start(ada.b, phone), DEV_CODE)).status).toBe(200);
    expect(await verifiedOnMe(ada.b)).toBe(true);
  });

  test("with the provider off the badge routes answer badge_unavailable, and a badge can still be removed", async () => {
    const ada = await signUp(appOff);
    const started = await ada.b.fetch("/api/auth/badge/start", { json: { phone: newPhone() } });
    expect(started.status).toBe(404);
    expect(await errorCode(started)).toBe("badge_unavailable");
    const verified = await ada.b.fetch("/api/auth/badge/verify", { json: { flowId: randomToken(), code: DEV_CODE } });
    expect(verified.status).toBe(404);
    expect(await errorCode(verified)).toBe("badge_unavailable");
    expect((await ada.b.fetch("/api/auth/badge", { method: "DELETE" })).status).toBe(204);
  });
});
