import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { describe, expect, test } from "vitest";
import type { AuthDeps } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { requireFreshAuth, requireStrongFreshAuth } from "../../src/auth/middleware";
import type { AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS, createSessions, type Factors, type Session, type Sessions } from "../../src/auth/sessions";
import type { AppEnv } from "../../src/env";

const T0 = 1_789_000_000_000;
const MINUTE = 60_000;

/** The freshness rules read nothing but the session and the clock: no row is ever read or written here. */
function setup(start = T0) {
  let t = start;
  const sessions = createSessions({ repo: {} as AuthRepo, kv: new MemoryKv(() => t), now: () => new Date(t) });
  return {
    sessions,
    advance(ms: number) {
      t += ms;
    },
  };
}

/** A resolved session of an account with or without TOTP, holding exactly the given factors. */
function session(factors: Factors, mfaEnabled = false): Session {
  const times = Object.values(factors);
  return {
    sessionId: sha256Hex(randomToken()),
    userId: randomUUID(),
    deviceId: randomUUID(),
    role: "user",
    onboarded: true,
    mfaEnabled,
    reauthAt: new Date(times.length > 0 ? Math.max(...times) : 0),
    handle: randomUUID(),
    factors,
    passkeyId: null,
  };
}

describe("session factors: freshness and level (1c design, sections 2 and 7.1)", () => {
  test("fresh means any factor within the window; a factor older than five minutes does not count, whatever reauthAt says", () => {
    const { sessions, advance } = setup();
    expect(sessions.isFresh(session({ email: T0 }))).toBe(true);
    expect(sessions.isFresh(session({}))).toBe(false);
    advance(REAUTH_WINDOW_MS);
    expect(sessions.isFresh(session({ email: T0 }))).toBe(true);
    advance(1);
    expect(sessions.isFresh(session({ email: T0 }))).toBe(false);
    expect(sessions.isFresh(session({ email: T0, totp: T0 + MINUTE }))).toBe(true);
    // The column follows the factors, never the other way round: a reauthAt of its own proves nothing.
    expect(sessions.isFresh({ ...session({ email: T0 }), reauthAt: new Date(T0 + REAUTH_WINDOW_MS + 1) })).toBe(false);
    // A shorter window applies to every factor alike.
    const recent = session({ email: T0 + REAUTH_WINDOW_MS - MINUTE });
    expect(sessions.isFresh(recent)).toBe(true);
    expect(sessions.isFresh(recent, MINUTE)).toBe(false);
  });

  test("the level rule: a user-verified passkey, or a TOTP or recovery code together with an email code, a password or a passkey, is level 2", () => {
    const { sessions } = setup();
    const levelTwo: Factors[] = [{ email: T0, totp: T0 }, { password: T0, recovery: T0 }, { passkey_uv: T0 }, { passkey: T0, totp: T0 }, { email: T0, recovery: T0, password: T0 }];
    for (const factors of levelTwo) expect(sessions.level(session(factors)), JSON.stringify(factors)).toBe(2);
    const levelOne: Factors[] = [{ totp: T0, recovery: T0 }, { email: T0 }, { password: T0 }, { passkey: T0 }, { email: T0, password: T0, passkey: T0 }, {}];
    for (const factors of levelOne) expect(sessions.level(session(factors)), JSON.stringify(factors)).toBe(1);
  });

  test("a factor older than five minutes counts towards no level, and the factors in time are listed by kind", () => {
    const { sessions, advance } = setup();
    const s = session({ email: T0, totp: T0 + 2 * MINUTE });
    expect(sessions.recentFactors(s)).toEqual(["email", "totp"]);
    expect(sessions.level(s)).toBe(2);
    advance(REAUTH_WINDOW_MS + 1);
    expect(sessions.recentFactors(s)).toEqual(["totp"]);
    expect(sessions.level(s)).toBe(1);
    expect(sessions.isFresh(s)).toBe(true);
    advance(2 * MINUTE);
    expect(sessions.recentFactors(s)).toEqual([]);
    expect(sessions.level(s)).toBe(1);
    expect(sessions.isFresh(s)).toBe(false);
  });

  test("an account with TOTP needs level 2 and one without needs level 1; a refusal names the level and the factors proven in time", () => {
    const { sessions, advance } = setup();
    expect(sessions.requiredLevel(session({ email: T0 }, true))).toBe(2);
    expect(sessions.requiredLevel(session({ email: T0 }, false))).toBe(1);
    const onlyEmail = session({ email: T0 }, true);
    expect(sessions.reauthNeeded(onlyEmail, 1)).toBeNull();
    expect(sessions.reauthNeeded(onlyEmail, 2)).toEqual({ level: 2, have: ["email"] });
    expect(sessions.reauthNeeded(session({ email: T0, totp: T0 }, true), 2)).toBeNull();
    expect(sessions.reauthNeeded(session({ totp: T0, recovery: T0 }, true), 2)).toEqual({ level: 2, have: ["totp", "recovery"] });
    advance(REAUTH_WINDOW_MS + 1);
    expect(sessions.reauthNeeded(onlyEmail, 1)).toEqual({ level: 1, have: [] });
    expect(sessions.reauthNeeded(onlyEmail, 2)).toEqual({ level: 2, have: [] });
  });
});

describe("the freshness middlewares", () => {
  /** One guard on one route, with the session a request would carry, or none. */
  function app(guard: MiddlewareHandler<AppEnv>, current: Session | null) {
    const a = new Hono<AppEnv>();
    a.use(async (c, next) => {
      c.set("requestId", "req-1");
      c.set("session", current);
      c.set("authVia", "cookie");
      await next();
    });
    a.get("/x", guard, (c) => c.text("ok"));
    return a;
  }
  const deps = (sessions: Sessions) => ({ sessions }) as unknown as AuthDeps;

  test("requireFreshAuth asks for level 1 and, refusing, says which factors the session has in time", async () => {
    const { sessions, advance } = setup();
    const s = session({ email: T0 }, true);
    expect((await app(requireFreshAuth(deps(sessions)), s).request("/x")).status).toBe(200);
    advance(REAUTH_WINDOW_MS + 1);
    const refused = await app(requireFreshAuth(deps(sessions)), s).request("/x");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: { code: "reauth_required", message: "Confirm it's you to continue.", requestId: "req-1", details: { level: 1, have: [] } },
    });
    // A window of the caller's own, in seconds, as the social module's handle change could ask for.
    expect((await app(requireFreshAuth(deps(sessions), 10 * 60), s).request("/x")).status).toBe(200);
  });

  test("requireStrongFreshAuth asks for level 2 on an account with TOTP and for level 1 otherwise", async () => {
    const { sessions } = setup();
    const strong = requireStrongFreshAuth(deps(sessions));
    const refused = await app(strong, session({ email: T0 }, true)).request("/x");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "reauth_required", details: { level: 2, have: ["email"] } } });
    expect((await app(strong, session({ totp: T0, recovery: T0 }, true)).request("/x")).status).toBe(403);
    expect((await app(strong, session({ email: T0, totp: T0 }, true)).request("/x")).status).toBe(200);
    expect((await app(strong, session({ password: T0, recovery: T0 }, true)).request("/x")).status).toBe(200);
    expect((await app(strong, session({ passkey_uv: T0 }, true)).request("/x")).status).toBe(200);
    expect((await app(strong, session({ email: T0 }, false)).request("/x")).status).toBe(200);
    const stale = await app(strong, session({}, false)).request("/x");
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ error: { code: "reauth_required", details: { level: 1, have: [] } } });
  });

  test("both answer 401 without a session", async () => {
    const { sessions } = setup();
    for (const guard of [requireFreshAuth(deps(sessions)), requireStrongFreshAuth(deps(sessions))]) {
      const res = await app(guard, null).request("/x");
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
    }
  });
});
