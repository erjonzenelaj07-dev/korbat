import {
  EmailChangeStartRequest,
  EmailChangeVerifyRequest,
  EmailStartRequest,
  EmailVerifyRequest,
  MfaVerifyRequest,
  NotMeRequest,
  OnboardingHandleRequest,
  PasswordSetRequest,
  PasswordSigninRequest,
  ReauthRequest,
  SignupCompleteRequest,
  TotpCodeRequest,
  type Platform,
} from "@korbat/contracts";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { AuthError, type AuthDeps, type RequestContext } from "./context";
import { clearSessionCookies, setSessionCookies } from "./cookies";
import { listSessions, me, revokeAllSessions, revokeSession, signOut } from "./flows/account";
import { startEmail, verifyEmail } from "./flows/email";
import { startEmailChange, verifyEmailChange } from "./flows/email-change";
import { confirmTotp, disableTotp, regenerateRecoveryCodes, setupTotp, verifyMfa } from "./flows/mfa";
import { notMe } from "./flows/not-me";
import { passwordSignIn, setPassword } from "./flows/password";
import { reauthenticate, startReauthEmail } from "./flows/reauth";
import type { MfaPending, SignedIn } from "./flows/signin";
import { chooseHandle, completeSignup } from "./flows/signup";
import { requireFreshAuth, requireOnboarding, requireSession } from "./middleware";
import type { IssuedSession, Session } from "./sessions";

/** Every `/api/auth/*` endpoint. Handlers only validate, call a flow and shape the response. */
export function authRoutes(deps: AuthDeps) {
  const r = new Hono<AppEnv>();
  const fresh = requireFreshAuth(deps);

  const requestContext = (c: Context<AppEnv>): RequestContext => ({
    ipHash: c.get("clientIpHash") ?? "direct",
    userAgent: c.req.header("user-agent"),
  });
  const currentSession = (c: Context<AppEnv>): Session => c.get("session")!;

  /**
   * Browsers send Origin on state changes and the fetch metadata headers Sec-Fetch-Site and Sec-Fetch-Dest
   * on every request; native apps send none of them, and Node's own fetch sends a bare Sec-Fetch-Mode that
   * cannot be removed, which therefore does not count. A request from a browser is a web session whatever
   * the body says, so it gets cookies, never a token.
   */
  const fromBrowser = (c: Context<AppEnv>): boolean =>
    c.req.header("origin") !== undefined || c.req.header("sec-fetch-site") !== undefined || c.req.header("sec-fetch-dest") !== undefined;
  const asWeb = <T extends { platform: Platform }>(c: Context<AppEnv>, input: T): T => (fromBrowser(c) ? { ...input, platform: "web" } : input);

  /** Web: cookies only, never the token in the body. Native: the bearer token in the body, no cookies. */
  const sessionIssued = (c: Context<AppEnv>, signed: SignedIn) => {
    if (signed.platform === "web") {
      setSessionCookies(c, signed.issued.token, signed.issued.maxAgeSeconds);
      return c.json({ result: "session" as const, mustReenrollMfa: signed.mustReenrollMfa });
    }
    return c.json({ result: "session" as const, mustReenrollMfa: signed.mustReenrollMfa, token: signed.issued.token });
  };

  const firstFactor = (c: Context<AppEnv>, outcome: SignedIn | MfaPending) =>
    outcome.kind === "mfa" ? c.json({ result: "mfa_required" as const, mfaTicket: outcome.mfaTicket }) : sessionIssued(c, outcome);

  /** After a flow rotated the current session: fresh cookies for web, the new token for native. */
  const rotated = (c: Context<AppEnv>, issued: IssuedSession): { token?: string } => {
    if (c.get("authVia") === "cookie") {
      setSessionCookies(c, issued.token, issued.maxAgeSeconds);
      return {};
    }
    return { token: issued.token };
  };

  r.onError((err, c) => {
    if (err instanceof AuthError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    if (err instanceof HTTPException) return c.json(errorBody("invalid_request", err.message, c.get("requestId")), err.status);
    c.get("log").error({ err }, "unhandled error in auth route");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  r.post("/email/start", validate("json", EmailStartRequest), async (c) => c.json(await startEmail(deps, asWeb(c, c.req.valid("json")), requestContext(c))));

  r.post("/email/verify", validate("json", EmailVerifyRequest), async (c) => {
    const outcome = await verifyEmail(deps, c.req.valid("json"), requestContext(c));
    if (outcome.kind === "signup_required") return c.json({ result: "signup_required" as const });
    return firstFactor(c, outcome);
  });

  r.post("/signup/complete", validate("json", SignupCompleteRequest), async (c) =>
    sessionIssued(c, await completeSignup(deps, c.req.valid("json"), requestContext(c))),
  );

  r.post("/onboarding/handle", requireOnboarding, validate("json", OnboardingHandleRequest), async (c) => {
    const { profile, issued } = await chooseHandle(deps, currentSession(c), c.req.valid("json"));
    return c.json({ profile, ...rotated(c, issued) });
  });

  r.post("/email/change/start", requireSession, fresh, validate("json", EmailChangeStartRequest), async (c) =>
    c.json(await startEmailChange(deps, currentSession(c), c.req.valid("json"), requestContext(c))),
  );

  r.post("/email/change/verify", requireSession, fresh, validate("json", EmailChangeVerifyRequest), async (c) =>
    c.json(await verifyEmailChange(deps, currentSession(c), c.req.valid("json"))),
  );

  r.post("/password/signin", validate("json", PasswordSigninRequest), async (c) =>
    firstFactor(c, await passwordSignIn(deps, asWeb(c, c.req.valid("json")), requestContext(c))),
  );

  r.post("/password/set", requireSession, fresh, validate("json", PasswordSetRequest), async (c) =>
    c.json(rotated(c, await setPassword(deps, currentSession(c), c.req.valid("json")))),
  );

  r.post("/mfa/verify", validate("json", MfaVerifyRequest), async (c) => sessionIssued(c, await verifyMfa(deps, c.req.valid("json"), requestContext(c))));

  r.post("/mfa/totp/setup", requireSession, fresh, async (c) => c.json(await setupTotp(deps, currentSession(c))));

  r.post("/mfa/totp/confirm", requireSession, fresh, validate("json", TotpCodeRequest), async (c) => {
    const { recoveryCodes, issued } = await confirmTotp(deps, currentSession(c), c.req.valid("json"));
    return c.json({ recoveryCodes, ...rotated(c, issued) });
  });

  r.post("/mfa/totp/disable", requireSession, fresh, validate("json", TotpCodeRequest), async (c) => {
    await disableTotp(deps, currentSession(c), c.req.valid("json"));
    return c.body(null, 204);
  });

  r.post("/mfa/recovery-codes/regenerate", requireSession, fresh, async (c) => c.json({ recoveryCodes: await regenerateRecoveryCodes(deps, currentSession(c)) }));

  r.post("/reauth/email/start", requireOnboarding, async (c) => c.json(await startReauthEmail(deps, currentSession(c), requestContext(c))));

  r.post("/reauth", requireOnboarding, validate("json", ReauthRequest), async (c) => {
    await reauthenticate(deps, currentSession(c), c.req.valid("json"));
    return c.body(null, 204);
  });

  r.get("/sessions", requireSession, async (c) => c.json(await listSessions(deps, currentSession(c))));

  r.delete("/sessions/:id", requireSession, fresh, validate("param", z.object({ id: z.string().regex(/^[0-9a-f]{64}$/) })), async (c) => {
    const revoked = await revokeSession(deps, currentSession(c), c.req.valid("param").id);
    return revoked ? c.body(null, 204) : c.json(errorBody("not_found", "No such session", c.get("requestId")), 404);
  });

  r.post("/sessions/revoke-all", requireSession, fresh, async (c) => {
    await revokeAllSessions(deps, currentSession(c));
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  r.post("/signout", requireOnboarding, async (c) => {
    await signOut(deps, currentSession(c));
    if (c.get("authVia") === "cookie") clearSessionCookies(c);
    return c.body(null, 204);
  });

  r.post("/not-me", validate("json", NotMeRequest), async (c) => {
    await notMe(deps, c.req.valid("json"), requestContext(c));
    return c.body(null, 204);
  });

  return r;
}

/** GET /api/me, mounted by the app behind requireOnboarding. */
export function meHandler(deps: AuthDeps) {
  return async (c: Context<AppEnv>) => c.json(await me(deps, c.get("session")!));
}
