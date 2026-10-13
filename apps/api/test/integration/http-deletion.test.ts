import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DeleteStartResponse, ErrorEnvelope, FlowResponse, MeResponse, PostView, SessionResult } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createSocial, enforceWriteLimit } from "../../src/social";
import { Browser, NativeClient } from "./http-client";
import { suspendRowForTest } from "./moderation-fixtures";

type App = ReturnType<typeof createApp>;

const newHandle = () => `del${randomBytes(4).toString("hex")}`;

/**
 * The deletion routes through the real app: 1a sign-up for the accounts, cookie and bearer sessions,
 * the auth module's freshness check, and the four modules wired as the server wires them.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: account deletion over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let auth: Auth;
  let app: App;
  const root = mkdtempSync(path.join(tmpdir(), "korbat-http-deletion-"));
  const mailer = new MemoryMailer();

  beforeAll(async () => {
    config = loadConfig();
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    // 3e: only the migrator writes a suspension into a profile row, as the ledger's standing_apply does.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
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
    const media = createMedia({
      apiDb,
      uploadsDir: path.join(root, "uploads"),
      storeDir: path.join(root, "store"),
      formats: config.MEDIA_FORMATS,
      minFreeBytes: 0,
      logger,
      requireSession: auth.requireSession,
      resolveSession: auth.resolveSession,
      rateLimitStore,
      enforceUploadLimit: (userId, accountCreatedAt, at) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, at),
    });
    await media.prepare();
    const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth(), media: media.forPosts, events: { append: auth.appendEvent } });
    const account = createAccount({
      auth: auth.forAccount,
      social: social.forAccount,
      media: media.forAccount,
      requireSession: auth.requireSession,
      requireFreshAuth: auth.requireFreshAuth(),
      requireStrongFreshAuth: auth.requireStrongFreshAuth(),
      rateLimitStore,
      logger,
    });
    app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account });
  });
  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** A signed-in web account, onboarded unless told otherwise. */
  async function signUp(onboard = true) {
    const b = new Browser(app, config.APP_ORIGIN);
    const email = `deletion-${randomUUID()}@korbat.local`;
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

  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const startOf = (b: Browser) => b.fetch("/api/account/delete/start", { method: "POST" });
  const sessionIdOf = (b: Browser) => sha256Hex(b.cookie("__Host-korbat_session")!);
  /** The session's only factor is the sign-up's email code; moved ten minutes back, nothing within the window is left, so the freshness check fails. */
  async function makeStale(b: Browser) {
    await auth.deps.repo.writeFactor(sessionIdOf(b), "email", new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:2:${sessionIdOf(b)}`);
  }

  test("both routes need an onboarded, fresh session", async () => {
    const confirmBody = JSON.stringify({ flowId: randomToken(), code: "123456", handle: "nobody" });
    for (const [path, body] of [
      ["/api/account/delete/start", undefined],
      ["/api/account/delete/confirm", confirmBody],
    ] as const) {
      const anonymous = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body });
      expect(anonymous.status, path).toBe(401);
      expect((await error(anonymous)).code, path).toBe("unauthenticated");
    }
    const notOnboarded = await signUp(false);
    const early = await startOf(notOnboarded.b);
    expect(early.status).toBe(403);
    expect((await error(early)).code).toBe("onboarding_required");
    const earlyConfirm = await notOnboarded.b.fetch("/api/account/delete/confirm", { json: { flowId: randomToken(), code: "123456", handle: "nobody" } });
    expect(earlyConfirm.status).toBe(403);
    expect((await error(earlyConfirm)).code).toBe("onboarding_required");

    const stale = await signUp();
    await makeStale(stale.b);
    const refused = await startOf(stale.b);
    expect(refused.status).toBe(403);
    expect((await error(refused)).code).toBe("reauth_required");
    const refusedConfirm = await stale.b.fetch("/api/account/delete/confirm", { json: { flowId: randomToken(), code: "123456", handle: stale.handle } });
    expect(refusedConfirm.status).toBe(403);
    expect((await error(refusedConfirm)).code).toBe("reauth_required");
    // Nothing was sent or changed for a refused start.
    expect(mailer.sent.filter((mail) => mail.to === stale.email).map((mail) => mail.template)).toEqual(["sign_up_code"]);
    expect((await stale.b.fetch("/api/me")).status).toBe(200);
  });

  test("the typed handle must be the account's own, then the code must be right", async () => {
    const ada = await signUp();
    const started = await startOf(ada.b);
    expect(started.status).toBe(200);
    const { flowId } = DeleteStartResponse.parse(await started.json());
    const code = mailer.lastCodeFor(ada.email)!;
    expect(mailer.sent.filter((mail) => mail.to === ada.email).map((mail) => mail.template)).toEqual(["sign_up_code", "delete_account_code"]);

    const mismatch = await ada.b.fetch("/api/account/delete/confirm", { json: { flowId, code, handle: "someone_else" } });
    expect(mismatch.status).toBe(400);
    expect(await error(mismatch)).toMatchObject({ code: "invalid_request", message: "handle_mismatch" });
    const wrong = await ada.b.fetch("/api/account/delete/confirm", { json: { flowId, code: String((Number(code) + 1) % 1_000_000).padStart(6, "0"), handle: ada.handle } });
    expect(wrong.status).toBe(400);
    expect((await error(wrong)).code).toBe("invalid_code");
    // Still signed in, still there.
    expect((await ada.b.fetch("/api/me")).status).toBe(200);
    expect((await app.request(`/api/profiles/${ada.handle}`)).status).toBe(200);
  });

  test("a web session's deletion answers 204 with both cookies cleared, and leaves nothing of the account reachable", async () => {
    const ada = await signUp();
    const created = await ada.b.fetch("/api/posts", { json: { body: "soon gone" } });
    expect(created.status).toBe(201);
    const post = PostView.parse(await created.json());
    const token = ada.b.cookie("__Host-korbat_session")!;
    const { flowId } = DeleteStartResponse.parse(await (await startOf(ada.b)).json());
    const confirmed = await ada.b.fetch("/api/account/delete/confirm", { json: { flowId, code: mailer.lastCodeFor(ada.email)!, handle: ada.handle.toUpperCase() } });
    expect(confirmed.status).toBe(204);
    expect(confirmed.headers.getSetCookie().filter((c) => c.includes("Max-Age=0"))).toHaveLength(2);
    expect(ada.b.cookie("__Host-korbat_session")).toBeUndefined();
    expect((await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${token}` } })).status).toBe(401);
    expect((await app.request(`/api/profiles/${ada.handle}`)).status).toBe(404);
    expect((await app.request(`/api/posts/${post.id}`)).status).toBe(404);
    expect(mailer.sent.filter((mail) => mail.to === ada.email).map((mail) => mail.template)).toEqual(["sign_up_code", "delete_account_code", "account_deleted"]);
    expect((await auth.deps.repo.recentEvents(ada.userId)).map((e) => e.type)).toContain("account_deleted");
    expect(await auth.deps.repo.pendingPurges()).not.toContain(ada.userId);
  });

  test("3e: while the account's suspension runs, its deletion answers as ever: no hold (GDPR Art. 17)", async () => {
    const ada = await signUp();
    const created = await ada.b.fetch("/api/posts", { json: { body: "posted before the suspension" } });
    expect(created.status).toBe(201);
    await suspendRowForTest(migrateDb, ada.userId);
    const refused = await ada.b.fetch("/api/posts", { json: { body: "while suspended" } });
    expect([refused.status, (await error(refused)).code]).toEqual([403, "account_suspended"]);
    const { flowId } = DeleteStartResponse.parse(await (await startOf(ada.b)).json());
    const confirmed = await ada.b.fetch("/api/account/delete/confirm", { json: { flowId, code: mailer.lastCodeFor(ada.email)!, handle: ada.handle } });
    expect(confirmed.status).toBe(204);
    expect((await app.request(`/api/profiles/${ada.handle}`)).status).toBe(404);
    expect(await auth.deps.repo.pendingPurges()).not.toContain(ada.userId);
  });

  test("a native session gets a plain 204 without cookies, and its token stops working", async () => {
    const native = new NativeClient(app);
    const email = `deletion-${randomUUID()}@korbat.local`;
    const handle = newHandle();
    const { flowId } = FlowResponse.parse(await (await native.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" } })).json());
    await native.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } });
    native.token = SessionResult.parse(await (await native.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-05-17", termsVersion: config.TERMS_VERSION } })).json()).token;
    const onboarded = (await (await native.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "Phone User" } })).json()) as { token: string };
    native.token = onboarded.token;

    const started = await native.fetch("/api/account/delete/start", { method: "POST" });
    expect(started.status).toBe(200);
    const deletion = DeleteStartResponse.parse(await started.json());
    const confirmed = await native.fetch("/api/account/delete/confirm", { json: { flowId: deletion.flowId, code: mailer.lastCodeFor(email)!, handle } });
    expect(confirmed.status).toBe(204);
    expect(confirmed.headers.getSetCookie()).toHaveLength(0);
    expect((await native.fetch("/api/me")).status).toBe(401);
    expect((await app.request(`/api/profiles/${handle}`)).status).toBe(404);
  });
});
