import { randomBytes, randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, MeResponse, ProfileView } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial } from "../../src/social";
import { Browser } from "./http-client";

type App = ReturnType<typeof createApp>;

const newHandle = () => `p${randomBytes(4).toString("hex")}`;

/**
 * The profile-editing routes through the real app: 1a sign-up for the accounts, cookie sessions with
 * CSRF, the auth module's freshness check on the handle change, and events written to auth_events
 * through the auth module, wired as the server wires them.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: profile editing and handle change over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let auth: Auth;
  let app: App;
  const mailer = new MemoryMailer();

  beforeAll(() => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    const rateLimitStore = new MemoryStore();
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async () => true },
      breachChecker: { isBreached: async () => false },
    });
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), events: { append: auth.appendEvent } });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  /** A signed-in web account, onboarded unless told otherwise. */
  async function signUp(onboard = true) {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `profile-${randomUUID()}@korbat.local`;
    const handle = newHandle();
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    expect((await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } })).status).toBe(200);
    expect((await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).status).toBe(200);
    if (onboard) expect((await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: `User ${handle}` } })).status).toBe(200);
    const me = MeResponse.parse(await (await b.fetch("/api/me")).json());
    return { b, handle, userId: me.user.id };
  }

  const errorCode = async (res: Response) => ErrorEnvelope.parse(await res.json()).error.code;
  /** The `{ profile }` body of a successful edit or handle change, checked against the contract. */
  const profileOf = async (res: Response) => {
    expect(res.status).toBe(200);
    return ProfileView.parse(((await res.json()) as { profile: unknown }).profile);
  };
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left, so the freshness check fails. */
  async function makeStale(b: Browser) {
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.writeFactor(sessionId, "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionId}`);
  }
  const eventTypes = async (userId: string) => (await auth.deps.repo.recentEvents(userId)).map((e) => e.type);
  const signedOut = (path: string, method: string, body: unknown) =>
    app.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  test("editing the profile needs an onboarded session; the edit is public at once and recorded", async () => {
    expect((await signedOut("/api/me/profile", "PATCH", { bio: "nobody" })).status).toBe(401);
    const notOnboarded = await signUp(false);
    const early = await notOnboarded.b.fetch("/api/me/profile", { method: "PATCH", json: { bio: "too early" } });
    expect(early.status).toBe(403);
    expect(await errorCode(early)).toBe("onboarding_required");

    const ada = await signUp();
    const edited = await profileOf(await ada.b.fetch("/api/me/profile", { method: "PATCH", json: { displayName: "Ada Lovelace", bio: "  Analytical engines.  " } }));
    expect(edited).toMatchObject({ id: ada.userId, handle: ada.handle, displayName: "Ada Lovelace", bio: "Analytical engines.", verified: false });
    expect(edited.viewer).toBeUndefined();
    expect(ProfileView.parse(await (await app.request(`/api/profiles/${ada.handle}`)).json())).toMatchObject({ displayName: "Ada Lovelace", bio: "Analytical engines." });
    const empty = await ada.b.fetch("/api/me/profile", { method: "PATCH", json: {} });
    expect(empty.status).toBe(400);
    expect(await errorCode(empty)).toBe("invalid_request");
    expect((await ada.b.fetch("/api/me/profile", { method: "PATCH", json: { bio: "x".repeat(161) } })).status).toBe(400);
    expect(await eventTypes(ada.userId)).toContain("profile_updated");
  });

  test("changing the handle needs an onboarded, fresh session; /me and the profile routes follow; the cooldown answers with Retry-After", async () => {
    expect((await signedOut("/api/me/handle", "POST", { handle: "nobody" })).status).toBe(401);
    const notOnboarded = await signUp(false);
    const early = await notOnboarded.b.fetch("/api/me/handle", { json: { handle: "too_early" } });
    expect(early.status).toBe(403);
    expect(await errorCode(early)).toBe("onboarding_required");

    const ada = await signUp();
    const bob = await signUp();
    const to = newHandle();
    const changed = await profileOf(await ada.b.fetch("/api/me/handle", { json: { handle: to.toUpperCase() } }));
    expect(changed).toMatchObject({ id: ada.userId, handle: to });
    const me = MeResponse.parse(await (await ada.b.fetch("/api/me")).json());
    expect(me.profile).toMatchObject({ id: ada.userId, handle: to, verified: false });
    expect(me.profile!.handleChangedAt).not.toBeNull();
    expect((await app.request(`/api/profiles/${ada.handle}`)).status).toBe(404);
    expect(ProfileView.parse(await (await app.request(`/api/profiles/${to}`)).json()).id).toBe(ada.userId);
    expect(await eventTypes(ada.userId)).toContain("handle_changed");

    const again = await ada.b.fetch("/api/me/handle", { json: { handle: newHandle() } });
    expect(again.status).toBe(429);
    expect(await errorCode(again)).toBe("handle_cooldown");
    expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(29 * 24 * 3600);

    const refusals = [
      [ada.handle, "handle_taken", 409],
      [to.toUpperCase(), "handle_taken", 409],
      ["admin", "handle_reserved", 400],
      ["ab", "handle_invalid", 400],
      [bob.handle, "invalid_request", 400],
    ] as const;
    for (const [handle, code, status] of refusals) {
      const refused = await bob.b.fetch("/api/me/handle", { json: { handle } });
      expect(refused.status, handle).toBe(status);
      expect(await errorCode(refused), handle).toBe(code);
    }
    expect(MeResponse.parse(await (await bob.b.fetch("/api/me")).json()).profile).toMatchObject({ handle: bob.handle, handleChangedAt: null });
    expect(await eventTypes(bob.userId)).not.toContain("handle_changed");

    await makeStale(bob.b);
    const stale = await bob.b.fetch("/api/me/handle", { json: { handle: newHandle() } });
    expect(stale.status).toBe(403);
    expect(await errorCode(stale)).toBe("reauth_required");
    // Editing the name or the bio needs a session but no fresh proof of a credential.
    expect((await bob.b.fetch("/api/me/profile", { method: "PATCH", json: { bio: "still allowed" } })).status).toBe(200);
  });
});
