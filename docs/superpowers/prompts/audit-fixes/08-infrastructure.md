# korbat audit fixes — Task 8 of 11: PostgreSQL 18 with a rehearsed upgrade, Valkey with a password, Caddy as its own user on 8080 with cache headers and body limits, three networks, memory and process limits, log rotation, images pinned by digest, pnpm through corepack, CI permissions and an image build, Renovate digest pinning, and scripts that refuse a remote Docker

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-23 and 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend in Docker Compose. This task moves the data services to PostgreSQL 18 (with a rehearsed script that moves the database from the PostgreSQL 16 volume) and to Valkey with a required password, runs Caddy as its own user on port 8080 with cache headers by kind of file and body limits, keeps the API's own headers on API responses, drops a client's CF-Connecting-IP unless the tunnel is in front, puts cloudflared, Caddy, the API and the data services on separate networks, sets memory, process and log limits on every service, pins every image by digest, installs pnpm through corepack from its hash, tightens CI, and makes the development scripts refuse a remote Docker. The design is `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`, section 8.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000 and 8080 on localhost must be free. Stop any korbat API, worker or web process started from this repository first; never stop other Node processes on the machine, and never touch Docker containers, volumes or images that do not belong to the `korbat` compose project.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `fix(app): navigation links are anchors (expo-router Link, Text href) so the keyboard can follow them; Delete asks first and actions wait for each other; paged lists run one request at a time and only the latest commits; a failed session load shows a retry and a 401 anywhere signs out; post ids are validated; metadata text and input borders meet WCAG contrast; dialogs are dialogs with initial focus, section headings are level 2, image cells are buttons; the HTML shell is dark with an inline icon; the terms name Turnstile and the device id; the Settings link is current on every settings page`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the files

```bash
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/08-infrastructure.md 1
```

Expected: 18 lines starting with `wrote`, one for each file below.

### Create `scripts/pg-major-upgrade.mjs`

```js
#!/usr/bin/env node
/**
 * Moves a database from the PostgreSQL 16 volume (`pgdata`, mounted at /var/lib/postgresql/data) to the
 * PostgreSQL 18 volume (`pgdata18`, mounted at /var/lib/postgresql) of the same Compose project:
 *
 * 1. stops the project's postgres service;
 * 2. starts the old server on the old volume in a throwaway container without network, prints the
 *    row counts of profiles, posts and applied migrations, and takes a pg_dump in custom format;
 * 3. starts the project's postgres service, which creates the new volume, the roles and the database;
 * 4. restores the dump as the superuser, so every object keeps its owner, and prints the counts again.
 *
 * The old volume is never changed or removed. The test database (`<name>_test`) is not moved; run
 * `node scripts/test-db.mjs` afterwards to create it again. Passwords stay inside the containers and
 * are never printed.
 *
 * Usage, from the repo root:
 *   node scripts/pg-major-upgrade.mjs [--old-image postgres:16.15-alpine] -- <docker compose command>
 */
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? [] : argv.slice(separator + 1);
const option = (name) => {
  const index = options.indexOf(`--${name}`);
  return index === -1 ? undefined : options[index + 1];
};
const oldImage = option("old-image") ?? "postgres:16.15-alpine";
if (compose.length === 0) {
  console.error("usage: node scripts/pg-major-upgrade.mjs [--old-image <image>] -- <docker compose command>");
  process.exit(2);
}

function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Runs a command and returns its result; a command that could not start stops the script. */
function run(cmd, args, extra = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 ** 3, ...extra });
  if (result.error) stop(`Could not run ${cmd}: ${result.error.message}`);
  return result;
}

const COUNTS = "select 'profiles=' || (select count(*) from profiles) || ' posts=' || (select count(*) from posts) || ' migrations=' || (select count(*) from drizzle.__drizzle_migrations)";

// 1. The project, its volumes and the database's name and superuser, from the resolved Compose file.
const configured = run(compose[0], [...compose.slice(1), "config", "--format", "json"]);
if (configured.status !== 0) stop(`docker compose config failed:${String.fromCharCode(10)}${configured.stderr}`);
const config = JSON.parse(configured.stdout);
const project = config.name;
const oldVolume = `${project}_pgdata`;
const newVolume = config.volumes?.pgdata18?.name ?? `${project}_pgdata18`;
const environment = config.services?.postgres?.environment ?? {};
const user = environment.POSTGRES_USER;
const database = environment.POSTGRES_DB;
if (!user || !database) stop("The postgres service has no POSTGRES_USER and POSTGRES_DB; is infra/.env complete?");

// 2. Nothing to move without the old volume; nothing to do when the new one already holds a cluster.
if (spawnSync("docker", ["volume", "inspect", oldVolume]).status !== 0) {
  console.log(`no ${oldVolume} volume: nothing to move, the stack starts on an empty PostgreSQL 18`);
  process.exit(0);
}
if (spawnSync("docker", ["volume", "inspect", newVolume]).status === 0) {
  const probe = run("docker", ["run", "--rm", "--network", "none", "-v", `${newVolume}:/var/lib/postgresql`, oldImage, "sh", "-c", "test -f /var/lib/postgresql/18/docker/PG_VERSION && echo cluster || echo empty"]);
  if (probe.stdout.trim() === "cluster") stop(`${newVolume} already holds a PostgreSQL 18 cluster. Remove it first if you really want to move ${oldVolume} again.`);
}

// 3. The old server, alone with its volume, dumps the database to stdout and reports its counts on stderr.
run(compose[0], [...compose.slice(1), "stop", "postgres"]);
const dumpScript = [
  "set -e",
  "docker-entrypoint.sh postgres >/tmp/pg.log 2>&1 &",
  "for i in $(seq 1 60); do pg_isready -q -U \"$POSTGRES_USER\" && break; sleep 1; done",
  "pg_isready -q -U \"$POSTGRES_USER\" || { cat /tmp/pg.log >&2; exit 1; }",
  "psql -tA -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -c \"$COUNTS\" >&2",
  "pg_dump -U \"$POSTGRES_USER\" -Fc \"$POSTGRES_DB\"",
].join(String.fromCharCode(10)); // one command per line: the background "&" may not be followed by ";"
console.log(`dumping ${database} from ${oldVolume} with ${oldImage}`);
const dumped = run("docker", ["run", "--rm", "--network", "none", "-v", `${oldVolume}:/var/lib/postgresql/data`, "-e", `POSTGRES_USER=${user}`, "-e", `POSTGRES_DB=${database}`, "-e", `COUNTS=${COUNTS}`, oldImage, "sh", "-c", dumpScript], { encoding: "buffer" });
const before = dumped.stderr.toString("utf8").trim().split(/\r?\n/).pop() ?? "";
if (dumped.status !== 0 || !before.startsWith("profiles=")) stop(`The dump failed:${String.fromCharCode(10)}${dumped.stderr.toString("utf8")}`);
console.log(`before: ${before} (${dumped.stdout.length} bytes dumped)`);

// 4. The new server creates its cluster, the roles and the empty database; the dump goes in as the superuser.
const started = run(compose[0], [...compose.slice(1), "up", "-d", "--wait", "postgres"]);
if (started.status !== 0) stop(`postgres did not start:${String.fromCharCode(10)}${started.stderr}`);
const restored = run(compose[0], [...compose.slice(1), "exec", "-T", "postgres", "pg_restore", "-U", user, "-d", database, "--exit-on-error"], { input: dumped.stdout });
if (restored.status !== 0) stop(`pg_restore failed:${String.fromCharCode(10)}${restored.stderr}`);
const counted = run(compose[0], [...compose.slice(1), "exec", "-T", "postgres", "psql", "-tA", "-U", user, "-d", database, "-c", COUNTS]);
const after = counted.stdout.trim();
console.log(`after:  ${after}`);
if (after !== before) stop(`The counts differ after the restore. The old volume ${oldVolume} is untouched.`);
console.log(`upgrade complete: ${database} now runs on PostgreSQL 18 in ${newVolume}`);
console.log(`The old volume ${oldVolume} was left in place. Remove it once you are sure: docker volume rm ${oldVolume}`);
console.log("The test database was not moved; run `node scripts/test-db.mjs` to create it again.");
```

### Replace `apps/api/src/auth/routes.ts` (whole file)

```ts
import {
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
```

### Replace `apps/api/test/integration/http-auth.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ErrorEnvelope, FlowResponse, MeResponse, SessionResult, SessionsResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, type Auth } from "../../src/auth";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { Browser, NativeClient } from "./http-client";

type App = ReturnType<typeof createApp>;

const newHandle = () => `h_${randomBytes(6).toString("hex")}`;

describe.skipIf(!process.env.INTEGRATION)("integration: auth over HTTP", () => {
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
    auth = createAuth({
      config,
      logger,
      authDb,
      kv: new MemoryKv(),
      mailer,
      profiles: createProfileStore(apiDb),
      turnstile: { verify: async (token) => token !== "fail" },
      breachChecker: { isBreached: async (password) => password.includes("breached") },
    });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth });
    // Routes must be registered before the first request builds the router.
    app.get("/api/test/staff-only", auth.requireSession, auth.requireStaffMfa, (c) => c.text("ok"));
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  async function signUp(b: Browser, platform: "web" | "ios" = "web") {
    const email = `http-${randomUUID()}@korbat.local`;
    const start = await b.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform } });
    expect(start.status).toBe(200);
    const { flowId } = FlowResponse.parse(await start.json());
    const verify = await b.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } });
    expect(await verify.json()).toEqual({ result: "signup_required" });
    const complete = await b.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "2000-01-01", termsVersion: config.TERMS_VERSION } });
    expect(complete.status).toBe(200);
    return { email, complete };
  }

  test("web sign-up end to end: cookies only, CSRF on state changes, onboarding, me and sessions", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { email, complete } = await signUp(b);
    expect(await complete.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(complete.headers.getSetCookie().find((c) => c.startsWith("__Host-korbat_session="))).toContain("HttpOnly");

    const before = MeResponse.parse(await (await b.fetch("/api/me")).json());
    expect(before.user).toMatchObject({ email, onboarded: false, hasPassword: false });
    expect(before.profile).toBeNull();

    const firstToken = b.cookie("__Host-korbat_session");
    const handle = newHandle();
    const withoutCsrf = await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "Web User" }, csrf: false });
    expect(withoutCsrf.status).toBe(403);
    expect(await withoutCsrf.json()).toMatchObject({ error: { code: "csrf_failed" } });

    const onboarded = await b.fetch("/api/auth/onboarding/handle", { json: { handle, displayName: "Web User" } });
    expect(onboarded.status).toBe(200);
    expect(await onboarded.json()).toEqual({ profile: { id: before.user.id, handle, displayName: "Web User" } });
    expect(b.cookie("__Host-korbat_session")).not.toBe(firstToken);

    const after = MeResponse.parse(await (await b.fetch("/api/me")).json());
    expect(after.user.onboarded).toBe(true);
    expect(after.profile?.handle).toBe(handle);
    const { sessions } = SessionsResponse.parse(await (await b.fetch("/api/auth/sessions")).json());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.current).toBe(true);
  });

  test("native clients get the token in the body and never cookies; bearer requests need no CSRF token", async () => {
    const native = new NativeClient(app);
    const email = `http-${randomUUID()}@korbat.local`;
    const start = await native.fetch("/api/auth/email/start", { json: { email, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" } });
    const { flowId } = FlowResponse.parse(await start.json());
    await native.fetch("/api/auth/email/verify", { json: { flowId, code: mailer.lastCodeFor(email) } });
    const complete = await native.fetch("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "2000-01-01", termsVersion: config.TERMS_VERSION } });
    expect(complete.status).toBe(200);
    const body = SessionResult.parse(await complete.json());
    expect(body.token).toMatch(/^kb1_[A-Za-z0-9_-]{43}$/);
    expect(complete.headers.getSetCookie()).toHaveLength(0);

    const onboarded = await app.request("/api/auth/onboarding/handle", {
      method: "POST",
      headers: { authorization: `Bearer ${body.token}`, "content-type": "application/json" },
      body: JSON.stringify({ handle: newHandle(), displayName: "Phone User" }),
    });
    expect(onboarded.status).toBe(200);
    const { token: rotated } = (await onboarded.json()) as { token?: string };
    expect(rotated).toMatch(/^kb1_/);
    expect((await app.request("/api/me", { headers: { authorization: `Bearer ${body.token}` } })).status).toBe(401);
    expect((await app.request("/api/me", { headers: { authorization: `Bearer ${rotated}` } })).status).toBe(200);
  });

  test("a browser gets cookies and no token even when it claims a native platform", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { complete } = await signUp(b, "ios");
    expect(await complete.json()).toEqual({ result: "session", mustReenrollMfa: false });
    expect(complete.headers.getSetCookie().some((c) => c.startsWith("__Host-korbat_session="))).toBe(true);
  });

  test("a script that sends only Sec-Fetch-Mode, as Node's fetch does, keeps its native platform", async () => {
    const headers = { "content-type": "application/json", "sec-fetch-mode": "cors", "cf-connecting-ip": "203.0.113.77" };
    const email = `http-${randomUUID()}@korbat.local`;
    const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
    const start = await post("/api/auth/email/start", { email, turnstileToken: "ok", deviceId: randomToken(), platform: "ios" });
    const { flowId } = FlowResponse.parse(await start.json());
    await post("/api/auth/email/verify", { flowId, code: mailer.lastCodeFor(email) });
    const complete = await post("/api/auth/signup/complete", { flowId, dateOfBirth: "2000-01-01", termsVersion: config.TERMS_VERSION });
    expect(complete.status).toBe(200);
    expect(SessionResult.parse(await complete.json()).token).toMatch(/^kb1_/);
    expect(complete.headers.getSetCookie()).toHaveLength(0);
  });

  test("malformed JSON is a 400 with the error envelope, not a 500", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const res = await b.fetch("/api/auth/email/verify", { raw: { type: "application/json", body: new TextEncoder().encode("{not json") } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
  });

  test("revoking one session needs fresh re-authentication", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Fresh" } });
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.setReauth(sessionId, new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionId}`);
    const revoke = await b.fetch(`/api/auth/sessions/${"0".repeat(64)}`, { method: "DELETE" });
    expect(revoke.status).toBe(403);
    expect(await revoke.json()).toMatchObject({ error: { code: "reauth_required" } });
  });

  test("other origins cannot change state; no session gets 401; unfinished onboarding gets 403", async () => {
    const evil = new Browser(app, "https://evil.example");
    const crossOrigin = await evil.fetch("/api/auth/email/start", { json: { email: "a@b.io", turnstileToken: "ok", deviceId: randomToken(), platform: "web" } });
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toMatchObject({ error: { code: "csrf_failed" } });

    const anonymous = await app.request("/api/me");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "unauthenticated" } });

    const b = new Browser(app, config.APP_ORIGIN);
    await signUp(b);
    const sessions = await b.fetch("/api/auth/sessions");
    expect(sessions.status).toBe(403);
    expect(await sessions.json()).toMatchObject({ error: { code: "onboarding_required" } });
  });

  test("sensitive routes need fresh re-authentication, which an emailed code provides", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { email } = await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Fresh" } });
    const token = b.cookie("__Host-korbat_session")!;
    const sessionId = sha256Hex(token);
    await auth.deps.repo.setReauth(sessionId, new Date(Date.now() - 10 * 60_000));
    await auth.deps.kv.del(`sess:${sessionId}`);

    const blocked = await b.fetch("/api/auth/password/set", { json: { password: "correct horse battery staple" } });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: { code: "reauth_required" } });

    const { flowId } = FlowResponse.parse(await (await b.fetch("/api/auth/reauth/email/start", { method: "POST" })).json());
    const reauth = await b.fetch("/api/auth/reauth", { json: { method: "email", flowId, code: mailer.lastCodeFor(email) } });
    expect(reauth.status).toBe(204);

    const set = await b.fetch("/api/auth/password/set", { json: { password: "correct horse battery staple" } });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({});
    expect(b.cookie("__Host-korbat_session")).not.toBe(token);
    expect(MeResponse.parse(await (await b.fetch("/api/me")).json()).user.hasPassword).toBe(true);
  });

  test("staff-only routes require a staff role and MFA", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const { email } = await signUp(b);
    await b.fetch("/api/auth/onboarding/handle", { json: { handle: newHandle(), displayName: "Staff" } });
    const regular = await b.fetch("/api/test/staff-only");
    expect(regular.status).toBe(403);
    expect(await regular.json()).toMatchObject({ error: { code: "forbidden" } });

    const user = (await auth.deps.repo.findUserByEmail(email))!;
    const sessionId = sha256Hex(b.cookie("__Host-korbat_session")!);
    await auth.deps.repo.setRole(user.id, "moderator");
    await auth.deps.kv.del(`sess:${sessionId}`);
    const withoutMfa = await b.fetch("/api/test/staff-only");
    expect(withoutMfa.status).toBe(403);
    expect(await withoutMfa.json()).toMatchObject({ error: { code: "staff_mfa_required" } });

    await auth.deps.repo.enableTotp(user.id, { secretEnc: "v1:unused", recoveryCodesHash: [], now: new Date() });
    await auth.deps.kv.del(`sess:${sessionId}`);
    expect((await b.fetch("/api/test/staff-only")).status).toBe(200);
  });

  test("signing out clears both cookies and ends the session", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    await signUp(b);
    const token = b.cookie("__Host-korbat_session")!;
    const signedOut = await b.fetch("/api/auth/signout", { method: "POST" });
    expect(signedOut.status).toBe(204);
    expect(signedOut.headers.getSetCookie().filter((c) => c.includes("Max-Age=0"))).toHaveLength(2);
    expect((await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${token}` } })).status).toBe(401);
  });

  test("validation and flow errors use the error envelope with the request id", async () => {
    const b = new Browser(app, config.APP_ORIGIN);
    const invalid = await b.fetch("/api/auth/email/verify", { json: { flowId: "nope", code: "12" } });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_request" } });

    const unknown = await b.fetch("/api/auth/email/verify", { json: { flowId: randomToken(), code: "123456" } });
    expect(unknown.status).toBe(400);
    const body = ErrorEnvelope.parse(await unknown.json());
    expect(body.error.code).toBe("invalid_code");
    expect(body.error.requestId).toBe(unknown.headers.get("x-request-id"));
  });
});
```

### Replace `infra/compose.yml` (whole file)

```yaml
name: korbat

x-logging: &logging
  driver: json-file
  options: { max-size: "20m", max-file: "5" }

x-node-common: &node-common
  restart: unless-stopped
  read_only: true
  tmpfs: ["/tmp"]
  security_opt: ["no-new-privileges:true"]
  logging: *logging

services:
  postgres:
    # PostgreSQL 18. From 18 on the image keeps the cluster under /var/lib/postgresql/<major>/docker, so
    # the volume is mounted one level up and a later major can pg_upgrade inside it. A cluster from the
    # earlier pgdata volume (PostgreSQL 16) is moved over by scripts/pg-major-upgrade.mjs.
    image: postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
    restart: unless-stopped
    logging: *logging
    mem_limit: 1g
    memswap_limit: 1g
    pids_limit: 256
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      KORBAT_MIGRATE_DB_PASSWORD: ${KORBAT_MIGRATE_DB_PASSWORD}
      KORBAT_API_DB_PASSWORD: ${KORBAT_API_DB_PASSWORD}
      KORBAT_AUTH_DB_PASSWORD: ${KORBAT_AUTH_DB_PASSWORD}
    volumes:
      - pgdata18:/var/lib/postgresql
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    networks: [data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    # Valkey, the BSD-licensed fork of Redis, under the service name the URLs already use. A password
    # is required: nothing on the data network may read the session cache without it.
    image: valkey/valkey:9.1.2-alpine@sha256:48332870af354a799964c0012ae1194a0bf2bf894eb508f945810596dc2d8d11
    restart: unless-stopped
    logging: *logging
    mem_limit: 384m
    memswap_limit: 384m
    pids_limit: 64
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:?set REDIS_PASSWORD in infra/.env}
    command: ["sh", "-c", "exec valkey-server --appendonly yes --maxmemory 256mb --maxmemory-policy noeviction --requirepass $$REDIS_PASSWORD"]
    volumes:
    # A fresh volume: Valkey 9 cannot read the RDB format 12 that Redis 7.4 wrote into `redisdata`, and that
    # volume held only transient state (limits, codes in flight, cached sessions, queued image jobs).
      - valkeydata:/data
    networks: [data]
    healthcheck:
      test: ["CMD-SHELL", "VALKEYCLI_AUTH=$$REDIS_PASSWORD valkey-cli ping | grep -q PONG"]
      interval: 5s
      timeout: 3s
      retries: 20

  migrate:
    <<: *node-common
    restart: "no"
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
    command: ["node", "dist/migrate.js"]
    environment:
      DATABASE_URL_MIGRATE: postgres://korbat_migrate:${KORBAT_MIGRATE_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      MIGRATIONS_DIR: /app/migrations
    networks: [data]
    depends_on:
      postgres: { condition: service_healthy }

  api:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/api/Dockerfile
      args:
        KORBAT_VERSION: ${KORBAT_VERSION:-0.0.0}
    mem_limit: 512m
    memswap_limit: 512m
    pids_limit: 256
    environment:
      # development or production, from infra/.env; production turns on the guards against test keys, plain-http
      # origins and a relay without TLS. The worker below always runs as production.
      NODE_ENV: ${KORBAT_ENV:?set KORBAT_ENV to development or production in infra/.env}
      PORT: "3000"
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      DATABASE_URL_API: postgres://korbat_api:${KORBAT_API_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      DATABASE_URL_AUTH: postgres://korbat_auth:${KORBAT_AUTH_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      TRUSTED_ORIGINS: ${API_TRUSTED_ORIGINS:-}
      # Which header names the client: the stack refuses to start without a choice.
      TRUST_PROXY: ${API_TRUST_PROXY:?set API_TRUST_PROXY in infra/.env}
      # Auth settings. The stack refuses to start while any of these is missing from infra/.env.
      APP_ORIGIN: ${API_APP_ORIGIN:?set API_APP_ORIGIN in infra/.env}
      AUTH_HMAC_KEY: ${API_AUTH_HMAC_KEY:?set API_AUTH_HMAC_KEY in infra/.env}
      IP_HASH_KEY: ${API_IP_HASH_KEY:?set API_IP_HASH_KEY in infra/.env}
      TOTP_ENC_KEY: ${API_TOTP_ENC_KEY:?set API_TOTP_ENC_KEY in infra/.env}
      TOTP_ENC_KEYS_PREVIOUS: ${API_TOTP_ENC_KEYS_PREVIOUS:-}
      TURNSTILE_SECRET_KEY: ${API_TURNSTILE_SECRET_KEY:?set API_TURNSTILE_SECRET_KEY in infra/.env}
      SMTP_URL: ${API_SMTP_URL:?set API_SMTP_URL in infra/.env}
      MAIL_FROM: ${API_MAIL_FROM:?set API_MAIL_FROM in infra/.env}
      TERMS_VERSION: ${API_TERMS_VERSION:?set API_TERMS_VERSION in infra/.env}
      # Images. The API writes uploads and only reads what the worker stored.
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
      MEDIA_MIN_FREE_BYTES: ${MEDIA_MIN_FREE_BYTES:-2147483648}
      MEDIA_RECONCILE: ${MEDIA_RECONCILE:-on}
    volumes:
      - media-uploads:/media/uploads
      - media-store:/media/store:ro
    networks: [app, data]
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 3s
      retries: 10

  # The image worker runs the decoder, the most exploitable code in the stack. It has no network at
  # all, no credentials and no capabilities: it reads uploads and writes the store, and that is
  # everything it can reach. The memory limit was sized on worst-case images (2b design, Research).
  worker:
    <<: *node-common
    build:
      context: ..
      dockerfile: apps/worker/Dockerfile
    network_mode: none
    cap_drop: [ALL]
    mem_limit: 768m
    memswap_limit: 768m
    cpus: 1.0
    pids_limit: 64
    tmpfs: ["/tmp:size=64m"]
    environment:
      NODE_ENV: production
      LOG_LEVEL: ${API_LOG_LEVEL:-info}
      MEDIA_UPLOADS_DIR: /media/uploads
      MEDIA_STORE_DIR: /media/store
      MEDIA_FORMATS: ${MEDIA_FORMATS:-jpeg,png,webp,gif,avif}
    volumes:
      - media-uploads:/media/uploads:ro
      - media-store:/media/store
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(Date.now() - JSON.parse(require('fs').readFileSync('/media/store/heartbeat', 'utf8')).at < 60000 ? 0 : 1)"]
      interval: 15s
      timeout: 5s
      retries: 4

  # Caddy serves the web app and proxies /api. It runs as its own user on port 8080, sees only the
  # API, and is the only thing cloudflared can reach.
  caddy:
    restart: unless-stopped
    read_only: true
    tmpfs: ["/tmp"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *logging
    mem_limit: 128m
    memswap_limit: 128m
    pids_limit: 64
    build:
      context: ..
      dockerfile: infra/caddy/Dockerfile
      args:
        EXPO_PUBLIC_TURNSTILE_SITE_KEY: ${WEB_TURNSTILE_SITE_KEY:?set WEB_TURNSTILE_SITE_KEY in infra/.env}
        KORBAT_ENV: ${KORBAT_ENV:?set KORBAT_ENV to development or production in infra/.env}
        TUNNEL: ${TUNNEL:-off}
    depends_on:
      api: { condition: service_healthy }
    volumes:
      - caddy-data:/data
      - caddy-config:/config
    networks: [edge, app]

  cloudflared:
    image: cloudflare/cloudflared:2026.9.1@sha256:b269e8abd07a5bf6f3f4be65d5050b2174eca89c56a0241a8ff32a16aec454e4
    restart: unless-stopped
    read_only: true
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    logging: *logging
    profiles: ["tunnel"]
    command: ["tunnel", "--no-autoupdate", "run"]
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    networks: [edge]
    depends_on:
      - caddy

# cloudflared reaches only Caddy, Caddy reaches only the API, and the API alone reaches the data services.
networks:
  edge:
  app:
  data:

volumes:
  # PostgreSQL 18. The earlier pgdata volume (PostgreSQL 16) stays until scripts/pg-major-upgrade.mjs has
  # moved it and you remove it by hand.
  pgdata18:
  valkeydata:
  # Uploads wait here for the worker and are deleted once processed. Nothing in it needs a backup.
  media-uploads:
  # The images korbat serves. Back it up together with the database.
  media-store:
  # Caddy's state, owned by its own user; the earlier root-owned caddydata and caddyconfig volumes can go.
  caddy-data:
  caddy-config:
```

### Replace `infra/compose.dev.yml` (whole file)

```yaml
# The development stack's host ports, all on 127.0.0.1. Any of them can be moved with a DEV_*_PORT line in
# infra/.env (for example DEV_PG_PORT=55433) when another container on the machine holds the default; the
# API's own apps/api/.env must then name the same port.
services:
  postgres:
    ports: ["127.0.0.1:${DEV_PG_PORT:-55432}:5432"]
  redis:
    ports: ["127.0.0.1:${DEV_REDIS_PORT:-56379}:6379"]
  api:
    ports: ["127.0.0.1:${DEV_API_PORT:-3000}:3000"]
  caddy:
    ports: ["127.0.0.1:${DEV_CADDY_PORT:-8080}:8080"]
  # Development mail catcher: SMTP on 51025, web UI and HTTP API on 58025. Never used in production.
  mailpit:
    image: axllent/mailpit:v1.31.2@sha256:74d609a42ec279aa63c6b4622a6fa9b5408d1ad5b1d76a1c4be40a265ce0863d
    restart: unless-stopped
    ports: ["127.0.0.1:${DEV_SMTP_PORT:-51025}:1025", "127.0.0.1:${DEV_MAILPIT_PORT:-58025}:8025"]
    networks: [data]
```

### Replace `infra/caddy/Caddyfile` (whole file)

```text
{
  auto_https off
  admin off
}

:8080 {
  # The API. Its own headers pass through untouched: its CSP is the strict one for JSON and images.
  handle /api/* {
    # Image uploads. The API counts bytes itself and stops at 20 MiB; this is the second line behind it.
    @upload path /api/media
    request_body @upload {
      max_size 25MB
    }
    # Everything else is JSON, and small. The API caps it at 64 KiB too.
    @json {
      not path /api/media
    }
    request_body @json {
      max_size 64KB
    }
    header -Server
    reverse_proxy api:3000 {
      # Behind the tunnel cloudflared sets CF-Connecting-IP and the API needs it; anywhere else a
      # client could set it, so Caddy drops it. Decided at build time by the TUNNEL argument.
      import /etc/caddy/cf-header.caddy
    }
  }

  # The web app: static files, the page's security headers, and caching by kind of file.
  handle {
    root * /srv
    encode gzip
    header {
      Strict-Transport-Security "max-age=31536000; includeSubDomains"
      X-Content-Type-Options "nosniff"
      X-Frame-Options "DENY"
      Referrer-Policy "no-referrer"
      Permissions-Policy "camera=(), microphone=(), geolocation=()"
      # challenges.cloudflare.com serves the Turnstile widget script and its iframe (sign-in screens).
      Content-Security-Policy "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
      -Server
    }
    # The page is revalidated on every load, so a deploy is seen at once; the hashed bundles never change.
    @immutable path /_expo/* /assets/*
    header @immutable Cache-Control "public, max-age=31536000, immutable"
    @page {
      not path /_expo/* /assets/*
    }
    header @page Cache-Control "no-cache"
    try_files {path} /index.html
    file_server
  }
}
```

### Replace `infra/caddy/Dockerfile` (whole file)

```dockerfile
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS web
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/app ./apps/app
RUN pnpm install --frozen-lockfile --filter @korbat/app...
# The public Turnstile site key is inlined into the web bundle at export time. It is not a secret.
ARG EXPO_PUBLIC_TURNSTILE_SITE_KEY
ARG KORBAT_ENV=development
RUN test -n "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" || { echo "the EXPO_PUBLIC_TURNSTILE_SITE_KEY build argument is required" >&2; exit 1; }
# Cloudflare's test keys pass every check, so a production build refuses them.
RUN if [ "$KORBAT_ENV" = "production" ]; then case "$EXPO_PUBLIC_TURNSTILE_SITE_KEY" in [123]x0*AA) echo "EXPO_PUBLIC_TURNSTILE_SITE_KEY is a Turnstile test key; a production build needs the site key of your own widget" >&2; exit 1;; esac; fi
RUN cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY="$EXPO_PUBLIC_TURNSTILE_SITE_KEY" npx expo export --platform web

FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b
ARG TUNNEL=off
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
# Behind the tunnel cloudflared sets CF-Connecting-IP and the API needs it; anywhere else a client could set it.
RUN if [ "$TUNNEL" = "on" ]; then : > /etc/caddy/cf-header.caddy; else echo "header_up -CF-Connecting-IP" > /etc/caddy/cf-header.caddy; fi
COPY --from=web /repo/apps/app/dist /srv
# The image's binary carries cap_net_bind_service as a file capability; with every capability dropped, the
# kernel refuses to run it ("operation not permitted"). Port 8080 needs no capability, so it is removed.
RUN setcap -r /usr/bin/caddy
# Caddy runs as its own user on a port it may bind without privileges; its state directories are its own.
RUN adduser -D -u 10001 caddy && mkdir -p /data /config && chown -R caddy:caddy /data /config
USER caddy
EXPOSE 8080
```

### Replace `infra/.env.example` (whole file)

```text
# Copy to infra/.env and change every password. Never commit infra/.env.
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me-superuser
POSTGRES_DB=korbat
KORBAT_MIGRATE_DB_PASSWORD=change-me-migrate
KORBAT_API_DB_PASSWORD=change-me-api
KORBAT_AUTH_DB_PASSWORD=change-me-auth
# Valkey (the session cache and rate-limit counters) refuses every command without it.
REDIS_PASSWORD=change-me-redis

# Images. The formats korbat accepts: remove one to refuse it and keep its decoder blocked, for
# example after a security advisory against that decoder, then restart api and worker.
MEDIA_FORMATS=jpeg,png,webp,gif,avif
# Uploads are refused while a media volume has less free space than this many bytes (2 GiB). The
# volumes share a disk with Postgres, and a full disk stops the database.
MEDIA_MIN_FREE_BYTES=2147483648
# The sweeper's pass that deletes images without a database row: on refuses when there are many of
# them (a database restored from an older snapshot looks like that), off skips it during a restore,
# force deletes them once you have checked.
MEDIA_RECONCILE=on

API_LOG_LEVEL=info
# Comma-separated browser origins allowed to call the API cross-origin. Empty in prod (same origin via Caddy).
API_TRUSTED_ORIGINS=http://localhost:8081

# Auth. `node scripts/gen-dev-env.mjs` fills the keys with random values and shares them with apps/api/.env.
# Origin the web app is served from (Caddy). Production: https://<your domain>.
API_APP_ORIGIN=http://localhost:8080
# Which header names the client: cloudflare when the tunnel is the only way in (the API then trusts
# cf-connecting-ip), caddy when Caddy's port is reachable directly. Never none behind a proxy.
API_TRUST_PROXY=caddy
API_AUTH_HMAC_KEY=change-me-key-auth-hmac
API_IP_HASH_KEY=change-me-key-ip-hash
API_TOTP_ENC_KEY=v1:change-me-key-totp
# Earlier TOTP keys, comma-separated, kept only while secrets they encrypted are still stored; a secret
# read with one is re-encrypted with API_TOTP_ENC_KEY.
API_TOTP_ENC_KEYS_PREVIOUS=
# Cloudflare's documented always-pass test secret. Production uses the secret of your Turnstile widget.
API_TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
# Mailpit from compose.dev.yml. Production: the EU relay, e.g. smtps://user:pass@smtp-relay.example:465
API_SMTP_URL=smtp://mailpit:1025
API_MAIL_FROM="korbat <no-reply@korbat.local>"
API_TERMS_VERSION=draft-2026-09

# Public Turnstile site key baked into the web image. Cloudflare's always-pass test key for development;
# production uses the site key of the same widget as API_TURNSTILE_SECRET_KEY.
WEB_TURNSTILE_SITE_KEY=1x00000000000000000000AA

# development or production. It is the API's NODE_ENV (production refuses Turnstile test keys, plain-http
# origins and a relay without TLS) and a build argument of the web image (production refuses the
# Turnstile test site key). Set it to production before building the images for the public.
KORBAT_ENV=development
# on when cloudflared is the only way in: Caddy then keeps CF-Connecting-IP for the API (and
# API_TRUST_PROXY is cloudflare). off drops the header, so nobody on the network can claim an address.
TUNNEL=off
# Cloudflare Tunnel token (Zero Trust > Networks > Tunnels). Only needed with --profile tunnel. The
# tunnel's public hostname must point at http://caddy:8080.
TUNNEL_TOKEN=

# The development stack's host ports, read only by infra/compose.dev.yml. Set one when another container
# on this machine holds the default, and give apps/api/.env the same port. Defaults: 55432, 56379, 3000,
# 8080, 51025, 58025.
# DEV_PG_PORT=55432
# DEV_REDIS_PORT=56379
# DEV_API_PORT=3000
# DEV_CADDY_PORT=8080
# DEV_SMTP_PORT=51025
# DEV_MAILPIT_PORT=58025
```

### Replace `apps/api/Dockerfile` (whole file)

```dockerfile
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @korbat/api...
RUN pnpm --filter @korbat/api build

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ENV NODE_ENV=production
ARG KORBAT_VERSION=0.0.0
ENV KORBAT_VERSION=$KORBAT_VERSION
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/migrations ./migrations
# argon2 is not bundled (native module). The install above ran on Alpine, so @node-rs holds the
# package and exactly the musl binary for this image's CPU architecture.
COPY --from=build /repo/node_modules/@node-rs ./node_modules/@node-rs
# The media volumes mount here. A new volume takes the owner of the path in the image, so both paths
# exist and belong to the user the process runs as, in this image and in the worker's.
RUN mkdir -p /media/uploads /media/store && chown node:node /media/uploads /media/store
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Replace `apps/worker/Dockerfile` (whole file)

```dockerfile
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter @korbat/worker...
RUN pnpm --filter @korbat/worker build

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ENV NODE_ENV=production
# libvips reads this when it loads, so it has to be in the environment before the process starts.
ENV VIPS_BLOCK_UNTRUSTED=1
WORKDIR /app
COPY --from=build /repo/apps/worker/dist ./dist
# sharp is not bundled (native module). The install above ran on Alpine, so @img holds exactly the
# musl binaries for this image's CPU architecture. detect-libc and semver are what sharp itself needs.
COPY --from=build /repo/node_modules/sharp ./node_modules/sharp
COPY --from=build /repo/node_modules/@img ./node_modules/@img
COPY --from=build /repo/node_modules/detect-libc ./node_modules/detect-libc
COPY --from=build /repo/node_modules/semver ./node_modules/semver
# The volumes mount here. A new volume takes the owner of the path in the image, so both paths
# exist and belong to the user the process runs as, in this image and in the API's.
RUN mkdir -p /media/uploads /media/store && chown node:node /media/uploads /media/store
USER node
CMD ["node", "dist/index.js"]
```

### Replace `apps/api/.env.example` (whole file)

```text
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
DATABASE_URL_API=postgres://korbat_api:change-me-api@localhost:55432/korbat
DATABASE_URL_AUTH=postgres://korbat_auth:change-me-auth@localhost:55432/korbat
DATABASE_URL_MIGRATE=postgres://korbat_migrate:change-me-migrate@localhost:55432/korbat
REDIS_URL=redis://:change-me-redis@localhost:56379
TRUSTED_ORIGINS=http://localhost:8081
APP_ORIGIN=http://localhost:8081
# Which header names the client: cloudflare (behind the tunnel), caddy (behind Caddy alone) or none (the
# socket). Development and the integration tests use cloudflare, the most permissive mode.
TRUST_PROXY=cloudflare
# Keys are generated by `node scripts/gen-dev-env.mjs`. Never reuse keys between environments.
AUTH_HMAC_KEY=change-me-key-auth-hmac
IP_HASH_KEY=change-me-key-ip-hash
TOTP_ENC_KEY=v1:change-me-key-totp
# Earlier TOTP keys, comma-separated, kept only while secrets they encrypted are still stored.
TOTP_ENC_KEYS_PREVIOUS=
# Cloudflare's documented always-pass test secret. Production uses the real secret.
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
# Local Mailpit from infra/compose.dev.yml. Production points at the EU relay.
SMTP_URL=smtp://localhost:51025
MAIL_FROM="korbat <no-reply@korbat.local>"
TERMS_VERSION=draft-2026-09
# Mailpit HTTP API, read by integration tests only.
MAILPIT_URL=http://localhost:58025
# Images on the host: the API writes uploads, the worker (apps/worker) writes the store. Both
# directories are created on demand under the repository's ignored .data folder.
MEDIA_UPLOADS_DIR=../../.data/media/uploads
MEDIA_STORE_DIR=../../.data/media/store
MEDIA_FORMATS=jpeg,png,webp,gif,avif
MEDIA_MIN_FREE_BYTES=2147483648
```

### Replace `package.json` (whole file)

```json
{
  "name": "korbat",
  "private": true,
  "packageManager": "pnpm@10.30.0+sha512.2b5753de015d480eeb88f5b5b61e0051f05b4301808a82ec8b840c9d2adf7748eb352c83f5c1593ca703ff1017295bc3fdd3119abb9686efc96b9fcb18200937",
  "engines": { "node": ">=24" },
  "scripts": {
    "typecheck": "pnpm -r --if-present run typecheck",
    "test": "pnpm -r --if-present run test",
    "build": "pnpm -r --if-present run build"
  },
  "devDependencies": {
    "typescript": "7.0.2"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["esbuild"],
    "overrides": {
      "query-string": "9.5.1"
    }
  }
}
```

### Replace `.github/workflows/ci.yml` (whole file)

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
        with: { version: 10.30.0 }
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: new lockfile entries are at least 7 days old
        env:
          BASE: ${{ github.event.pull_request.base.sha || github.event.before }}
        run: |
          if [ -z "$BASE" ] || [ "$BASE" = "0000000000000000000000000000000000000000" ]; then
            echo "no base commit to compare with"
          else
            node scripts/check-lockfile-age.mjs --base "$BASE"
          fi
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm audit --audit-level high
      - run: pnpm --filter @korbat/api build && pnpm --filter @korbat/worker build
      - run: pnpm --filter @korbat/app exec expo export --platform web
        env:
          EXPO_PUBLIC_TURNSTILE_SITE_KEY: 1x00000000000000000000AA
      - run: docker compose --env-file infra/.env.example -f infra/compose.yml config -q

  semgrep:
    runs-on: ubuntu-latest
    container: semgrep/semgrep:1.177.0@sha256:acaac22ffc7b7cc5926de0751b223bce0b2491c33d18422fa72f632c78d81198
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - run: semgrep scan --config p/owasp-top-ten --config p/typescript --config p/secrets --error --exclude apps/app/dist --exclude node_modules

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - name: the api, worker and web images build
        run: docker compose --env-file infra/.env.example -f infra/compose.yml build
```

### Replace `renovate.json` (whole file)

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":semanticCommits", "docker:pinDigests"],
  "schedule": ["before 6am on monday"],
  "minimumReleaseAge": "7 days",
  "packageRules": [
    { "matchUpdateTypes": ["minor", "patch"], "groupName": "non-major dependencies", "minimumReleaseAge": "7 days" },
    { "matchPackageNames": ["expo", "react-native"], "enabled": false, "minimumReleaseAge": "7 days", "description": "Expo SDK upgrades are done by hand with expo upgrade" }
  ],
  "vulnerabilityAlerts": { "enabled": true, "labels": ["security"] }
}
```

### Replace `scripts/gen-dev-env.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Creates or completes the local .env files from their committed examples: infra/.env,
 * apps/api/.env, apps/app/.env and apps/worker/.env.
 *
 * - `change-me-<word>`          -> 48 random hex characters (passwords)
 * - `change-me-key-<name>`      -> 32 random bytes, base64 (HMAC keys)
 * - `v1:change-me-key-<name>`   -> `v1:` + 32 random bytes, base64 (versioned encryption keys)
 * - `change-me-api|auth|migrate|redis` inside apps/api/.env -> the matching password from infra/.env
 * - Keys used by both the API in Docker (`API_<NAME>` in infra/.env) and the API on the host
 *   (`<NAME>` in apps/api/.env) are generated once and copied to the other file, so both processes
 *   hash, sign and encrypt with the same keys.
 *
 * A value that already exists in a .env file is never changed. Keys that are new in an example
 * are appended. Values are never printed.
 *
 * It also writes apps/api/.env.test, the environment of the integration tests: apps/api/.env with
 * the database URLs pointing at `<database>_test` and the Redis URL at database 15. That file is
 * derived on every run, so it cannot drift from apps/api/.env. `node scripts/test-db.mjs` creates
 * the database it names.
 *
 * It only serves development: it refuses to run when infra/.env already names a public origin,
 * because production values are set by hand and never generated.
 *
 * Usage: node scripts/gen-dev-env.mjs
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LINE = /^([A-Z0-9_]+)=(.*)$/;

function parse(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function read(rel) {
  const path = resolve(root, rel);
  return existsSync(path) ? parse(readFileSync(path, "utf8")) : new Map();
}

/** `shared` holds key values that already exist in the other .env file, by this file's variable name. */
function generate(name, value, infra, shared) {
  if (value.includes("change-me-key-") && shared.has(name)) return shared.get(name);
  if (value.startsWith("v1:change-me-key-")) return `v1:${randomBytes(32).toString("base64")}`;
  if (value.startsWith("change-me-key-")) return randomBytes(32).toString("base64");
  return value
    .replace(/change-me-(api|auth|migrate|redis)\b/g, (match, role) => (role === "redis" ? infra.get("REDIS_PASSWORD") : infra.get(`KORBAT_${role.toUpperCase()}_DB_PASSWORD`)) ?? match)
    .replace(/change-me-[a-z]+/g, () => randomBytes(24).toString("hex"));
}

function complete(relExample, relTarget, infra, shared) {
  const example = readFileSync(resolve(root, relExample), "utf8");
  const targetPath = resolve(root, relTarget);

  if (!existsSync(targetPath)) {
    const lines = example.split(/\r?\n/).map((line) => {
      const m = LINE.exec(line);
      return m ? `${m[1]}=${generate(m[1], m[2], infra, shared)}` : line;
    });
    writeFileSync(targetPath, lines.join("\n"), "utf8");
    console.log(`${relTarget}: created with ${parse(example).size} keys`);
    return;
  }

  const current = readFileSync(targetPath, "utf8");
  const existing = parse(current);
  const added = [];
  let out = current.replace(/\s*$/, "\n");
  for (const [name, value] of parse(example)) {
    if (existing.has(name)) continue;
    out += `${name}=${generate(name, value, infra, shared)}\n`;
    added.push(name);
  }
  if (added.length === 0) {
    console.log(`${relTarget}: nothing to add`);
    return;
  }
  writeFileSync(targetPath, out, "utf8");
  console.log(`${relTarget}: completed, added ${added.join(", ")}`);
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const existingOrigin = read("infra/.env").get("API_APP_ORIGIN");
if (existingOrigin !== undefined) {
  let host = "";
  try {
    host = new URL(existingOrigin).hostname;
  } catch {
    host = "";
  }
  if (!LOCAL_HOSTS.includes(host)) {
    console.error(`API_APP_ORIGIN in infra/.env is "${existingOrigin}", not a localhost origin. This script generates development values only; set production values by hand.`);
    process.exit(1);
  }
}

const hostApi = read("apps/api/.env");
complete("infra/.env.example", "infra/.env", new Map(), new Map([...hostApi].map(([name, value]) => [`API_${name}`, value])));

const infra = read("infra/.env");
const dockerApi = new Map([...infra].filter(([name]) => name.startsWith("API_")).map(([name, value]) => [name.slice("API_".length), value]));
complete("apps/api/.env.example", "apps/api/.env", infra, dockerApi);

/** A REDIS_URL written before Valkey required a password gains the one infra/.env holds. */
function addRedisPassword(relTarget, password) {
  if (!password) return;
  const path = resolve(root, relTarget);
  const current = readFileSync(path, "utf8");
  const line = current.split(/\r?\n/).find((l) => l.startsWith("REDIS_URL="));
  if (!line) return;
  const url = new URL(line.slice("REDIS_URL=".length));
  if (url.password) return;
  url.password = password;
  writeFileSync(path, current.replace(line, `REDIS_URL=${url.href}`), "utf8");
  console.log(`${relTarget}: REDIS_URL now carries the Valkey password`);
}
addRedisPassword("apps/api/.env", infra.get("REDIS_PASSWORD"));

complete("apps/app/.env.example", "apps/app/.env", new Map(), new Map());
complete("apps/worker/.env.example", "apps/worker/.env", new Map(), new Map());

/** Rewrites apps/api/.env.test from apps/api/.env. Only where the data lives changes; every key stays the same. */
function deriveTestEnv() {
  const lines = readFileSync(resolve(root, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .map((line) => {
      const m = LINE.exec(line);
      if (!m) return line;
      const [, name, value] = m;
      if (/^DATABASE_URL_(API|AUTH|MIGRATE)$/.test(name)) {
        const url = new URL(value);
        if (!url.pathname.endsWith("_test")) url.pathname = `${url.pathname}_test`;
        return `${name}=${url.href}`;
      }
      if (name === "REDIS_URL") {
        const url = new URL(value);
        url.pathname = "/15";
        return `${name}=${url.href}`;
      }
      return line;
    });
  const header = "# Derived from apps/api/.env by scripts/gen-dev-env.mjs. Do not edit this file: rerun the script.";
  writeFileSync(resolve(root, "apps/api/.env.test"), [header, ...lines].join("\n"), "utf8");
  console.log("apps/api/.env.test: derived from apps/api/.env (test database, Redis database 15)");
}

deriveTestEnv();
```

### Replace `scripts/clean-dev-fixtures.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Lists, and with --yes deletes, what tests left in the development database:
 *
 * - accounts whose email has the tests' shape, `<word>-<uuid>@korbat.local` (the integration, HTTP and
 *   smoke tests all make them), with their profiles;
 * - profiles without an account behind them, which the integration suites inserted directly while they
 *   still ran against this database.
 *
 * Deleting a profile removes its posts, image rows, follows, likes, reposts, bookmarks, blocks and mutes.
 * Where those rows counted towards a kept profile or post (a follow of a real account, a like of a real
 * post), that counter is recomputed from the rows, the way the app keeps it. The API's sweeper removes
 * the image files within about an hour, as it does for any image without a row.
 *
 * Refuses to run unless Docker's context is this machine and API_APP_ORIGIN in infra/.env is a localhost origin, so it never touches a
 * deployed database. Runs psql inside the postgres container as its superuser: no password is read or
 * printed here.
 *
 * Usage, from the repo root:
 *   node scripts/clean-dev-fixtures.mjs [--yes] [-- <docker compose command>]
 * Without a command it uses `docker compose -f infra/compose.yml -f infra/compose.dev.yml`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? ["docker", "compose", "-f", "infra/compose.yml", "-f", "infra/compose.dev.yml"] : argv.slice(separator + 1);
const unknown = options.filter((option) => option !== "--yes");
if (compose.length === 0 || unknown.length > 0) {
  console.error("usage: node scripts/clean-dev-fixtures.mjs [--yes] [-- <docker compose command>]");
  process.exit(2);
}
const yes = options.includes("--yes");

/** The only emails tests create: a lowercase word or words, a UUID, and the korbat.local domain. */
const TEST_EMAIL = "^[a-z]+(-[a-z]+)*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@korbat[.]local$";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
/** How many of each kind are printed; the counts are always complete. */
const LISTED = 25;
const NL = String.fromCharCode(10);
/** psql meta-commands start with a backslash; spelled this way, the file holds none that could be lost in copying. */
const META = String.fromCharCode(92);

function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Docker's current context must be this machine: a remote context would point these commands at another host. */
function requireLocalDocker() {
  const inspected = spawnSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" });
  const host = inspected.status === 0 ? inspected.stdout.trim() : "";
  if (!/^(unix:|npipe:)/.test(host)) stop(`Docker's current context points at "${host || "an unknown endpoint"}", not this machine. This script only runs against a local stack.`);
}
requireLocalDocker();

const envFile = resolve(root, "infra/.env");
if (!existsSync(envFile)) stop("infra/.env is missing. Run `node scripts/gen-dev-env.mjs` first.");
const origin = parseEnv(readFileSync(envFile, "utf8")).API_APP_ORIGIN ?? "";
let host = "";
try {
  host = new URL(origin).hostname;
} catch {
  host = "";
}
if (!LOCAL_HOSTS.includes(host)) stop(`API_APP_ORIGIN in infra/.env is "${origin}", not a localhost origin. This script only cleans a development database.`);

// Runs inside the postgres container, where POSTGRES_USER and POSTGRES_DB are set. psql fills in
// :'pattern' itself, so the pattern is never pasted into SQL by hand. Everything happens in one
// transaction, which only commits with --yes.
const script = `set -eu
psql -v ON_ERROR_STOP=1 -q -tA --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v pattern="$PATTERN" -v delete="$DELETE" <<'SQL'
begin;
create temp table doomed on commit drop as
  select u.id, 'account' as kind, u.email || coalesce(' (@' || p.handle || ')', '') as label
    from auth.users u left join public.profiles p on p.id = u.id
    where u.email ~ :'pattern'
  union all
  select p.id, 'profile', '@' || p.handle
    from public.profiles p
    where not exists (select 1 from auth.users u where u.id = p.id);
create temp table touched_profiles on commit drop as
  select f.followee_id as id from public.follows f
    where f.follower_id in (select id from doomed) and f.followee_id not in (select id from doomed)
  union
  select f.follower_id from public.follows f
    where f.followee_id in (select id from doomed) and f.follower_id not in (select id from doomed);
create temp table touched_posts on commit drop as
  select distinct x.post_id as id
    from (
      select user_id as by_id, post_id from public.likes
      union all select user_id, post_id from public.reposts
      union all select author_id, reply_to_id from public.posts where reply_to_id is not null
      union all select author_id, quote_of_id from public.posts where quote_of_id is not null
    ) x
    join public.posts p on p.id = x.post_id
    where x.by_id in (select id from doomed) and p.author_id not in (select id from doomed);
select 'database|' || current_database();
select 'accounts|' || count(*) from doomed where kind = 'account';
select 'profiles|' || count(*) from doomed where kind = 'profile';
select 'posts|' || count(*) from public.posts where author_id in (select id from doomed);
select 'images|' || count(*) from public.post_media where owner_id in (select id from doomed);
select 'touched_profiles|' || count(*) from touched_profiles;
select 'touched_posts|' || count(*) from touched_posts;
select kind || '-item|' || label from doomed order by kind, label;
${META}if :delete
delete from public.profiles where id in (select id from doomed);
delete from auth.users where id in (select id from doomed);
update public.profiles p set
    follower_count = (select count(*) from public.follows f where f.followee_id = p.id),
    following_count = (select count(*) from public.follows f where f.follower_id = p.id)
  where p.id in (select id from touched_profiles);
update public.posts p set
    like_count = (select count(*) from public.likes l where l.post_id = p.id),
    repost_count = (select count(*) from public.reposts r where r.post_id = p.id),
    reply_count = (select count(*) from public.posts c where c.reply_to_id = p.id and c.state <> 'deleted_by_author'),
    quote_count = (select count(*) from public.posts c where c.quote_of_id = p.id and c.state <> 'deleted_by_author')
  where p.id in (select id from touched_posts);
commit;
select 'deleted|yes';
${META}else
rollback;
${META}endif
SQL
`;

const run = spawnSync(compose[0], [...compose.slice(1), "exec", "-T", "-e", `PATTERN=${TEST_EMAIL}`, "-e", `DELETE=${yes ? "on" : "off"}`, "postgres", "sh", "-s"], {
  cwd: root,
  input: script,
  encoding: "utf8",
});
if (run.error) stop(`Could not run ${compose[0]}: ${run.error.message}`);
if (run.status !== 0) stop(`The database could not be read. Is the postgres service up?${NL}${run.stderr}`);

const report = new Map();
const listed = { account: [], profile: [] };
for (const line of run.stdout.split(NL).map((text) => text.trim())) {
  const bar = line.indexOf("|");
  if (bar === -1) continue;
  const key = line.slice(0, bar);
  if (key === "account-item") listed.account.push(line.slice(bar + 1));
  else if (key === "profile-item") listed.profile.push(line.slice(bar + 1));
  else report.set(key, line.slice(bar + 1));
}
const count = (key) => Number(report.get(key) ?? 0);

function show(title, key, labels) {
  console.log(`${title}: ${count(key)}`);
  for (const label of labels.slice(0, LISTED)) console.log(`  ${label}`);
  if (labels.length > LISTED) console.log(`  ... and ${labels.length - LISTED} more`);
}

console.log(`database ${report.get("database")}`);
show("accounts with a test email", "accounts", listed.account);
show("profiles without an account", "profiles", listed.profile);
if (count("accounts") + count("profiles") === 0) {
  console.log("Nothing to clean.");
  process.exit(0);
}
console.log(`their posts: ${count("posts")}, image rows: ${count("images")}`);
console.log(`kept profiles and posts whose counters include them: ${count("touched_profiles")} and ${count("touched_posts")}`);
if (report.get("deleted") === "yes") {
  console.log(`Deleted ${count("accounts")} accounts and ${count("profiles")} profiles with everything they made; recomputed the counters of ${count("touched_profiles")} profiles and ${count("touched_posts")} posts.`);
  console.log("Their image files leave the store when the API's sweeper next finds them without a row, within about an hour.");
} else {
  console.log("Nothing was deleted. Run again with --yes to delete these.");
}
```

### Replace `scripts/smoke-auth-stack.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Smoke test of the auth and social modules in a running Compose stack, through Caddy.
 *
 * 1. The web page's CSP allows the Turnstile widget.
 * 2. Password sign-in for an unknown email returns invalid_credentials (argon2 runs inside the image).
 * 3. A throwaway native-app account signs up with an emailed code read from Mailpit and onboards.
 * 4. /api/me answers for it.
 * 5. It posts, the post appears in the public Latest timeline, and its profile counts one post.
 * 6. It uploads a JPEG carrying a GPS position, waits until it is ready, and posts it without text. The
 *    original upload is gone, and large.webp is served to anyone as a fresh WebP without metadata.
 * 7. A symlink to /proc/self/environ, planted in the store from inside the worker, is refused with 404.
 * 8. Deleting the post stops the image being served, and its folder leaves the store.
 * 9. The worker has only a loopback interface and a 768 MiB memory limit, and has never restarted.
 * 10. With --worst-case, flat-colour files at the pixel caps (48 MP 16-bit interlaced PNG, 48 MP
 *     progressive JPEG, 48 MP GIF, 16 MP AVIF) all become ready without the worker being OOM-killed or
 *     restarted, and its memory peak is printed. Run it after every sharp upgrade.
 * 11. The grant-role CLI makes it a moderator, and its session stops working.
 *
 * Runs only against a local Docker context. Needs API_TURNSTILE_SECRET_KEY set to Cloudflare's always-pass test secret and API_SMTP_URL pointing
 * at Mailpit. Makes its images with the sharp the worker uses. Tries a Turnstile refusal again for up to a
 * minute, since outbound calls can stall. Prints no codes or tokens.
 *
 * Usage, from the repo root:
 *   node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 \
 *     --terms draft-2026-09 [--worst-case] -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? [] : argv.slice(separator + 1);
const option = (name) => {
  const index = options.indexOf(`--${name}`);
  return index === -1 ? undefined : options[index + 1];
};
const base = option("base");
const mailpit = option("mailpit");
const terms = option("terms");
const worstCase = options.includes("--worst-case");
if (!base || !mailpit || !terms || compose.length === 0) {
  console.error("usage: node scripts/smoke-auth-stack.mjs --base <url> --mailpit <url> --terms <version> [--worst-case] -- <docker compose command>");
  process.exit(2);
}
function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Docker's current context must be this machine: a remote context would point these commands at another host. */
function requireLocalDocker() {
  const inspected = spawnSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" });
  const host = inspected.status === 0 ? inspected.stdout.trim() : "";
  if (!/^(unix:|npipe:)/.test(host)) stop(`Docker's current context points at "${host || "an unknown endpoint"}", not this machine. This script only runs against a local stack.`);
}
requireLocalDocker();

/** The sharp the worker depends on, so the test images come from the same library that will read them. */
const sharp = createRequire(new URL("../apps/worker/package.json", import.meta.url))("sharp");

/** Cloudflare's test secret accepts any token. */
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const deviceId = randomBytes(32).toString("base64url");
const email = `smoke-${randomUUID()}@korbat.local`;
const handle = `smoke_${randomBytes(4).toString("hex")}`;
let failures = 0;

function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
  return ok;
}

async function api(path, { json, token } = {}) {
  const headers = {};
  if (json !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method: json === undefined ? "GET" : "POST", headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

/**
 * Cloudflare's siteverify is a call across the internet, and the API fails closed when it stalls past
 * five seconds. On Docker Desktop, containers' outbound calls stall for up to half a minute right after a
 * heavy image build, which is not a fault of the stack, so a Turnstile refusal is tried again every five
 * seconds for up to a minute. A wrong secret still fails, a minute later.
 */
async function withTurnstile(path, json) {
  const deadline = Date.now() + 60_000;
  let result = await api(path, { json });
  while (result.body?.error?.code === "turnstile_failed" && Date.now() < deadline) {
    console.log(`info ${path}: Turnstile could not be verified; trying again in 5 s`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    result = await api(path, { json });
  }
  return result;
}

/** Any request, with a raw body; answers with the status, the headers and the body's bytes. */
async function send(path, { method = "GET", token, body, type } = {}) {
  const headers = {};
  if (type) headers["content-type"] = type;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method, headers, body });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
}

/** Runs a shell command in a service's container. Its stdin is closed, so nothing can wait on it. */
function inside(service, command) {
  return execFileSync(compose[0], [...compose.slice(1), "exec", "-T", service, "sh", "-c", command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function workerState() {
  const id = execFileSync(compose[0], [...compose.slice(1), "ps", "-q", "worker"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
  const fields = execFileSync(compose[0], ["inspect", id, "--format", "{{.HostConfig.Memory}} {{.RestartCount}} {{.State.OOMKilled}}"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
    .trim()
    .split(" ");
  return { memory: Number(fields[0]), restarts: Number(fields[1]), oomKilled: fields[2] === "true" };
}

async function upload(bytes, type, token) {
  const sent = await send("/api/media", { method: "POST", token, body: bytes, type });
  let id = null;
  try {
    id = JSON.parse(sent.bytes.toString("utf8")).id ?? null;
  } catch {
    id = null;
  }
  return { status: sent.status, id };
}

/** Polls an upload until it is no longer processing; the worker gives up on a file after two minutes. */
async function waitReady(id, token) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const res = await api(`/api/media/${id}`, { token });
    if (res.body?.status !== "processing") return res.body ?? { status: res.summary };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { status: "still processing after 150 s" };
}

const PLANTED = "korbat-smoke-planted-text";
/** 51 deg 30 min north, the latitude planted below, as EXIF writes it: three rationals of 32-bit numbers. */
const LATITUDE = [51, 1, 30, 1, 0, 1];
function hasLatitude(bytes) {
  const little = Buffer.alloc(24);
  const big = Buffer.alloc(24);
  LATITUDE.forEach((value, index) => {
    little.writeUInt32LE(value, index * 4);
    big.writeUInt32BE(value, index * 4);
  });
  return bytes.includes(little) || bytes.includes(big);
}

async function images(token) {
  const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#2f6f4f" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: PLANTED }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" } })
    .toBuffer();
  check("the test JPEG carries a GPS position and planted text", hasLatitude(jpeg) && jpeg.includes(PLANTED));

  const sent = await upload(jpeg, "image/jpeg", token);
  if (!check("upload it through Caddy", sent.status === 202 && sent.id !== null, `HTTP ${sent.status}`)) return;
  const id = sent.id;
  const state = await waitReady(id, token);
  if (!check("the image is ready", state.status === "ready", state.error ?? state.status)) return;
  check("the original upload is gone", inside("api", `test -e /media/uploads/incoming/${id} && echo present || echo gone`) === "gone");

  const created = await api("/api/posts", { json: { media: [{ id, alt: "A plain green test image" }] }, token });
  if (!check("post it without text", created.status === 201 && created.body?.media?.length === 1, created.summary)) return;
  const large = created.body.media[0].large;
  const file = await send(large);
  const served = `HTTP ${file.status}, ${file.headers.get("content-type")}, ${file.headers.get("cache-control")}`;
  check("large.webp is served to anyone and may be cached publicly", file.status === 200 && file.headers.get("content-type") === "image/webp" && file.headers.get("cache-control") === "public, max-age=300", served);
  const meta = await sharp(file.bytes).metadata();
  const clean = meta.format === "webp" && meta.exif === undefined && meta.xmp === undefined && meta.icc === undefined;
  check("large.webp is a fresh WebP without EXIF, XMP, ICC, the GPS position or the planted text", clean && !hasLatitude(file.bytes) && !file.bytes.includes(PLANTED), `${meta.format} ${meta.width}x${meta.height}`);

  const shard = id.slice(0, 2);
  inside("worker", `ln -sf /proc/self/environ /media/store/files/${shard}/${id}/large.webp`);
  const planted = await send(large);
  const leaked = /DATABASE_URL|PASSWORD|SECRET|_KEY=/.test(planted.bytes.toString("latin1"));
  check("a symlink planted in the store by the worker is refused, and nothing leaks", planted.status === 404 && !leaked, `HTTP ${planted.status}`);

  const removed = await send(`/api/posts/${created.body.id}`, { method: "DELETE", token });
  check("delete the post", removed.status === 204, `HTTP ${removed.status}`);
  const after = await send(large);
  check("its image is no longer served", after.status === 404, `HTTP ${after.status}`);
  let folder = "present";
  for (let attempt = 0; attempt < 60 && folder !== "gone"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    folder = inside("api", `test -e /media/store/files/${shard}/${id} && echo present || echo gone`);
  }
  check("its folder is gone from the store", folder === "gone");

  const interfaces = inside("worker", "ls -x /sys/class/net");
  check("the worker has only a loopback interface", interfaces === "lo", interfaces);
  const worker = workerState();
  check("the worker's memory limit is 768 MiB", worker.memory === 768 * 1024 * 1024, `${worker.memory} bytes`);
  check("the worker has never restarted or been OOM-killed", worker.restarts === 0 && !worker.oomKilled, `restarts ${worker.restarts}, OOM-killed ${worker.oomKilled}`);
}

/** Flat colour compresses to almost nothing, so every file is small to send and at its cap to decode. */
const WORST_CASE = [
  ["48 MP 16-bit interlaced PNG", "image/png", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#806040" } }).toColourspace("rgb16").png({ progressive: true }).toBuffer()],
  ["48 MP progressive JPEG", "image/jpeg", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#406080" } }).jpeg({ progressive: true }).toBuffer()],
  ["48 MP GIF", "image/gif", () => sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#608040" } }).gif().toBuffer()],
  ["16 MP AVIF", "image/avif", () => sharp({ create: { width: 4000, height: 4000, channels: 3, background: "#804060" } }).avif({ effort: 0 }).toBuffer()],
];

async function worstCaseImages(token) {
  for (const [label, type, make] of WORST_CASE) {
    const bytes = await make();
    const sent = await upload(bytes, type, token);
    const state = sent.id ? await waitReady(sent.id, token) : { status: `HTTP ${sent.status}` };
    check(`worst case: ${label} is ready`, state.status === "ready", `${state.error ?? state.status}, ${Math.round(bytes.length / 1024)} KiB sent`);
    if (sent.id) await send(`/api/media/${sent.id}`, { method: "DELETE", token });
  }
  const worker = workerState();
  check("worst case: the worker was never OOM-killed or restarted", worker.restarts === 0 && !worker.oomKilled, `restarts ${worker.restarts}, OOM-killed ${worker.oomKilled}`);
  const peak = Number(inside("worker", "cat /sys/fs/cgroup/memory.peak"));
  console.log(`info worst case: the worker's memory peak is ${Math.round(peak / 1048576)} MiB of ${Math.round(worker.memory / 1048576)} MiB`);
}

async function signUpCode(to) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const newest = list.messages?.[0];
    if (newest) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${newest.ID}`)).json();
      const code = /\b(\d{6})\b/.exec(message.Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no code email to ${to} arrived in Mailpit`);
}

async function main() {
  const page = await fetch(`${base}/`);
  const csp = page.headers.get("content-security-policy") ?? "";
  check("web CSP allows the Turnstile widget", csp.includes("script-src 'self' https://challenges.cloudflare.com") && csp.includes("frame-src https://challenges.cloudflare.com"));

  const unknown = await withTurnstile("/api/auth/password/signin", { email: `nobody-${randomUUID()}@korbat.local`, password: "not a real password", turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  check("password sign-in for an unknown email", unknown.body?.error?.code === "invalid_credentials", unknown.summary);

  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await signUpCode(email) } });
  if (!check("sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;

  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Smoke Test" }, token: complete.body.token });
  if (!check("onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;
  const me = await api("/api/me", { token });
  check("/api/me for the new account", me.status === 200 && me.body?.user?.email === email && me.body?.user?.role === "user", me.summary);

  const created = await api("/api/posts", { json: { body: "smoke test post" }, token });
  check("create a post", created.status === 201 && typeof created.body?.id === "string", created.summary);
  const latest = await api("/api/timeline/latest");
  check("the post appears in the public Latest timeline", Array.isArray(latest.body?.items) && latest.body.items.some((item) => item.post?.id === created.body?.id), latest.summary);
  const profile = await api(`/api/profiles/${handle}`);
  check("the profile counts one post", profile.body?.counts?.posts === 1, profile.summary);

  await images(token);
  if (worstCase) await worstCaseImages(token);

  const output = execFileSync(compose[0], [...compose.slice(1), "run", "--rm", "--no-deps", "-T", "api", "node", "dist/grant-role.js", email, "moderator"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  check("grant-role CLI", output.includes("role user -> moderator; every session revoked"), output.trim());
  const after = await api("/api/me", { token });
  check("the session stops working after the role change", after.status === 401, after.summary);
}

try {
  await main();
} catch (err) {
  check("smoke test ran to the end", false, err instanceof Error ? err.message : String(err));
}
console.log(failures === 0 ? "smoke test passed" : `smoke test FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
```

### Replace `README.md` (whole file)

````markdown
# korbat

Pseudonymous social platform with a narrow public rulebook and transparent moderation. Self-hosted.

- Design spec: `docs/superpowers/specs/2026-09-03-korbat-design.md`
- Accounts and sessions (sub-project 1a): `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`
- Posting and feed (sub-project 2a): `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`
- Plans: `docs/superpowers/plans/`

## Dev quick start
```bash
pnpm install
node scripts/gen-dev-env.mjs                # creates or completes infra/.env, apps/api/.env, apps/app/.env and apps/worker/.env, and derives apps/api/.env.test; values are random and never printed
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit   # dev host ports 55432, 56379, 51025, 58025 (movable: DEV_*_PORT in infra/.env)
pnpm --filter @korbat/api dev               # http://localhost:3000/api/health; reads apps/api/.env
pnpm --filter @korbat/worker dev            # the image worker; reads apps/worker/.env and works on .data/media
pnpm --filter @korbat/app web               # http://localhost:8081
```

Emails sent in development (sign-in codes, new-device alerts, lockout notices) land in Mailpit at http://localhost:58025. Locally the web app uses Cloudflare's always-pass Turnstile test key, so the human check never blocks you.

The data services are PostgreSQL 18 and Valkey (the BSD-licensed fork of Redis, still under the service name `redis`, on its own volume `valkeydata`: Valkey 9 cannot read the RDB format 12 that Redis 7.4 wrote into the old `redisdata` volume, which held only transient state and can be removed with `docker volume rm`). Valkey needs the password from `infra/.env`; `gen-dev-env` writes it into the API's `REDIS_URL` too, so an older `.env` is fixed by running it again.

korbat once ran MinIO and never used it. Images live on two Docker volumes instead, `media-uploads` and `media-store`. If an old stack left a `korbat_miniodata` volume behind, `docker volume rm korbat_miniodata` removes it.

## Tests
```bash
pnpm test                                     # unit tests of every package
node scripts/test-db.mjs                      # creates or migrates the korbat_test database; run it again after adding a migration
pnpm --filter @korbat/api test:integration    # needs postgres, redis and mailpit up
```

Integration tests have their own database, `korbat_test`, and their own Redis database, 15. Both are named in `apps/api/.env.test`, which `node scripts/gen-dev-env.mjs` derives from `apps/api/.env`. Every run starts by emptying them, and refuses to start if a URL points anywhere else, so tests never touch development data.

Before they had their own database, the integration suites left accounts, profiles and posts in the development database, and the smoke test still leaves one account per run. To see and remove them:

```bash
node scripts/clean-dev-fixtures.mjs          # lists test accounts and profiles without an account; deletes nothing
node scripts/clean-dev-fixtures.mjs --yes    # deletes them with everything they made
```

It only matches emails of the tests' shape, `<word>-<uuid>@korbat.local`, recomputes the counters of kept profiles and posts they touched, and refuses to run unless `API_APP_ORIGIN` in `infra/.env` is a localhost origin.

## Full stack
```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build   # http://localhost:8080
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

The smoke test signs up a throwaway account through Caddy, reads its code from Mailpit, posts and reads the post back from the public Latest timeline. It uploads a JPEG carrying a GPS position, posts it, and checks that the served file is a fresh WebP without metadata, that a symlink planted in the store from inside the worker gets a 404, and that deleting the post removes the image from disk. It checks the worker's isolation, then grants the account a staff role with the CLI and checks that its session was revoked.

After every sharp upgrade, add `--worst-case`: it also uploads flat-colour files at the pixel caps (48 MP 16-bit interlaced PNG, 48 MP progressive JPEG, 48 MP GIF, 16 MP AVIF), expects each to be ready without the worker being OOM-killed or restarted, and prints the worker's memory peak.

Caddy listens on 8080 inside its container as its own user, proxies `/api` to the API and serves the web app with the page's security headers; `index.html` is revalidated on every load and the hashed bundles are cached for a year. The compose file keeps cloudflared, Caddy, the API and the data services on separate networks, so cloudflared reaches only Caddy and Caddy only the API.

## Upgrading PostgreSQL

The stack runs PostgreSQL 18 on the `pgdata18` volume. A database from the earlier PostgreSQL 16 volume (`pgdata`) is moved by:

```bash
node scripts/pg-major-upgrade.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

It dumps the old cluster with the old image in a throwaway container, starts the new server, restores the dump with every owner kept, and compares the row counts. The old volume stays until you remove it; the test database is created again by `node scripts/test-db.mjs`.

## Restoring

Restore the database and the `media-store` volume from the same moment. The API's sweeper deletes images that have no row: after a database restored from an older snapshot it would delete every image posted since. It refuses when there are many such images, but for a restore window set `MEDIA_RECONCILE=off` in `infra/.env` before starting the API, and put it back to `on` once the store matches the database. `force` makes one pass delete them anyway, for when they really are orphans.

## Posting and feed
Text posts up to 1000 characters, replies, quotes, likes, reposts and bookmarks; follows, blocks and mutes; a chronological Following timeline and a public Latest timeline; threads and profile pages. The web app's home is the timeline; sign-in lives at `/signin`.

- **Reading signed out:** Latest, threads and profiles are public. Following, bookmarks, likes, follower lists and privacy settings need a session.
- **Blocks** are enforced in every query, not just the interface: neither account sees the other while signed in, follows are removed both ways, and the blocked side gets `not_found` so nothing is revealed. Posts are public, so a block does not hide them from someone who signs out; the interface says so.
- **Mutes** are one-way and silent, and hide an account from your timelines only.
- **Liker lists are never exposed.** Counts are public; likes and bookmarks are private to their owner.
- **Write limits** per account, tiered by account age: in the first 24 hours 5 posts and 20 replies an hour and no reposts or quotes for 48 hours; afterwards 30 posts and 60 replies an hour. Everyone: 100 likes an hour, 50 follows an hour and 400 a day, 30 blocks or mutes an hour. Undo actions are never limited.
- **Deleting** blanks the text in the database and leaves a tombstone only where a thread or a quote needs it. There is no editing.

## Images
Posts, replies and quotes can carry up to four images, and every image needs a description of up to 1000 characters. The web composer takes JPEG, PNG, WebP, AVIF and still GIF files up to 20 MB, and refuses HEIC with advice to export a JPEG.

- **Nothing of the original is kept.** The upload goes to the `media-uploads` volume, a separate worker container decodes it and writes fresh WebP files in two sizes (1024 and 2048 pixels on the long side) without any metadata to `media-store`, and the original is deleted once the image is ready.
- **The worker is boxed in.** It has no network, no credentials and no capabilities, runs as a non-root user on a read-only file system within 768 MiB, one CPU and 64 processes, and only reads `media-uploads`. Decoders outside the allowlist are blocked, and the pixel count is checked from the header before decoding: 50 MP, 16 MP for AVIF, 16383 pixels on a side.
- **Formats can be switched off** without a deploy, for example while a codec advisory is open: remove it from `MEDIA_FORMATS` in `infra/.env` and restart `api` and `worker`.
- **Who sees an image** follows its post: anyone for a visible post, with a public five-minute cache; only the author for a withheld or removed post, never cached; nobody once the post is deleted, and its files leave the disk.
- **Behind Cloudflare**, set Browser Cache TTL to "Respect Existing Headers", or browsers keep images for four hours whatever the server says.

## Staff roles
No API endpoint changes roles. Run this on the server:
```bash
docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>
```
Every session of the account is revoked and the change is written to the audit log. Staff tools refuse moderators and admins until they turn on two-factor authentication.

## Before going public
Set these in `infra/.env`:
- `API_APP_ORIGIN` to the public origin, for example `https://korbat.example`; the API refuses a plain-http origin in production.
- `API_TURNSTILE_SECRET_KEY` and `WEB_TURNSTILE_SITE_KEY` to the keys of one Turnstile widget; the API and the web build refuse Cloudflare's test keys in production.
- `API_SMTP_URL` and `API_MAIL_FROM` to the EU mail relay; a plain `smtp://` relay must offer STARTTLS, which the API requires in production.
- `KORBAT_ENV=production` before building the images; it is the API's `NODE_ENV` too, so the guards above are on.
- `TUNNEL=on` and `API_TRUST_PROXY=cloudflare` when cloudflared is the only way in (the tunnel's hostname points at `http://caddy:8080`); `TUNNEL=off` and `API_TRUST_PROXY=caddy` when Caddy's port is reachable directly. With `on`, Caddy keeps `CF-Connecting-IP` for the API; with `off` it drops it, so nobody can claim an address.
- In Cloudflare, set Browser Cache TTL to "Respect Existing Headers", or browsers keep images for four hours whatever the server says.

Keep `API_AUTH_HMAC_KEY`, `API_IP_HASH_KEY` and `API_TOTP_ENC_KEY` secret and backed up. Losing `API_TOTP_ENC_KEY` breaks every enrolled authenticator. To rotate it, put the old key in `API_TOTP_ENC_KEYS_PREVIOUS` and a new `v2:` key in `API_TOTP_ENC_KEY`; each secret is re-encrypted with the new key when it is next used.

## Dependency audit

`pnpm audit --audit-level high` runs in CI. Two lower advisories are accepted, both in build-time tools that never see untrusted input here: `esbuild` 0.18 under drizzle-kit's config loader (its development server, which nothing starts) and `uuid` 7 under Expo's Xcode config plugin. Renovate moves them with their parents.
````

## Step 2: verify: typecheck

```bash
pnpm --filter @korbat/api typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 3: verify: dev-env

```bash
node scripts/gen-dev-env.mjs && echo infra-keys=$(grep -c '^REDIS_PASSWORD=\|^MEDIA_RECONCILE=\|^API_TRUST_PROXY=\|^API_TOTP_ENC_KEYS_PREVIOUS=\|^KORBAT_ENV=\|^TUNNEL=' infra/.env) && echo api-redis-auth=$(grep -c '^REDIS_URL=redis://:' apps/api/.env)
```

Expected output contains:

- `apps/api/.env.test: derived`
- `infra-keys=6`
- `api-redis-auth=1`

Observed on the dry run:

```text
apps/api/.env.test: derived from apps/api/.env (test database, Redis database 15)
infra-keys=6
api-redis-auth=1
```

## Step 4: verify: compose-config

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok
```

Expected output contains:

- `config-ok`

Observed on the dry run:

```text
config-ok
```

## Step 5: verify: stack-down

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok
```

Expected output contains:

- `down-ok`

Observed on the dry run:

```text
down-ok
```

## Step 6: verify: build

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml build > .data/stack-build.log 2>&1; echo build-exit=$?; tail -3 .data/stack-build.log
```

Expected output contains:

- `build-exit=0`

Allowed difference: The images build for several minutes; the step hides the build's output in `.data/stack-build.log`. If `build-exit=0` is missing, read that file: `ECONNRESET` warnings from pnpm inside the build mean Docker's network is failing, which is a STOP condition to report, not to work around.

Observed on the dry run:

```text
build-exit=0
```

## Step 7: verify: pg-upgrade

```bash
node scripts/pg-major-upgrade.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `upgrade complete`
- `was left in place`

Must not contain:

- `failed`
- `differ`

Observed on the dry run:

```text
upgrade complete: korbat now runs on PostgreSQL 18 in korbat_pgdata18
The old volume korbat_pgdata was left in place. Remove it once you are sure: docker volume rm korbat_pgdata
```

## Step 8: verify: stack-up

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok
```

Expected output contains:

- `up-ok`

Observed on the dry run:

```text
up-ok
```

## Step 9: verify: postgres-version

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc "select split_part(version(), ' ', 2)"
```

Expected output contains:

- `18.6`

Observed on the dry run:

```text
18.6
```

## Step 10: verify: valkey-auth

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T redis valkey-cli ping; docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T redis sh -c 'VALKEYCLI_AUTH=$REDIS_PASSWORD valkey-cli ping'
```

Expected output contains:

- `NOAUTH`
- `PONG`

Observed on the dry run:

```text
NOAUTH Authentication required.
PONG
```

## Step 11: verify: caddy-user

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T caddy id -u
```

Expected output contains:

- `10001`

Observed on the dry run:

```text
10001
```

## Step 12: verify: page-headers

```bash
( curl -sI http://localhost:8080/ | grep -iE '^(cache-control|content-security-policy|server):' ) | tr 'A-Z' 'a-z'
```

Expected output contains:

- `cache-control: no-cache`
- `default-src 'self'`

Must not contain:

- `server:`

Observed on the dry run:

```text
cache-control: no-cache
content-security-policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'
```

## Step 13: verify: api-headers

```bash
( curl -sI http://localhost:8080/api/health | grep -iE '^(content-security-policy|server|cache-control):' ) | tr 'A-Z' 'a-z'
```

Expected output contains:

- `default-src 'none'`
- `cache-control: no-store`

Must not contain:

- `server:`

Observed on the dry run:

```text
cache-control: no-store
content-security-policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'
```

## Step 14: verify: bundle-headers

```bash
( js=$(curl -s http://localhost:8080/ | grep -o '/_expo/static/js/web/[^"]*' | head -1); echo "bundle: $js"; curl -sI "http://localhost:8080$js" | grep -i '^cache-control' ) | tr 'A-Z' 'a-z'
```

Expected output contains:

- `bundle: /_expo/static/js/web/`
- `max-age=31536000, immutable`

Observed on the dry run:

```text
bundle: /_expo/static/js/web/entry-32c02196944994cb6281d7a63295679f.js
cache-control: public, max-age=31536000, immutable
```

## Step 15: verify: body-limit

```bash
head -c 70000 /dev/zero | tr '\0' 'x' > .data/big.json; curl -s -o /dev/null -w 'json=%{http_code}' -X POST -H 'content-type: application/json' --data-binary @.data/big.json http://localhost:8080/api/auth/email/start; echo
```

Expected output contains:

- `json=413`

Observed on the dry run:

```text
json=413
```

## Step 16: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Must not contain:

- `failed`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 17: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `smoke test passed`

Must not contain:

- `FAIL`

Observed on the dry run:

```text
smoke test passed
```

## Step 18: verify: remote-docker-refused

```bash
DOCKER_CONTEXT=not-a-context node scripts/clean-dev-fixtures.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml; echo rc=$?
```

Expected output contains:

- `not this machine`
- `rc=1`

Observed on the dry run:

```text
rc=1
Docker's current context points at "an unknown endpoint", not this machine. This script only runs against a local stack.
```

## Step 19: verify: integration

```bash
cd apps/api && pnpm test:integration
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  156 passed (156)
```

## Step 20: verify: stack-stop

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker cloudflared 2>/dev/null; docker compose -f infra/compose.yml -f infra/compose.dev.yml ps --format '{{.Name}} {{.Status}}'
```

Expected output contains:

- `postgres-1 Up`

Observed on the dry run:

```text
korbat-postgres-1 Up About a minute (healthy)
```

## Step 21: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `.github/workflows/ci.yml`
- `README.md`
- `apps/api/.env.example`
- `apps/api/Dockerfile`
- `apps/api/src/auth/routes.ts`
- `apps/api/test/integration/http-auth.test.ts`
- `apps/worker/Dockerfile`
- `infra/.env.example`
- `infra/caddy/Caddyfile`
- `infra/caddy/Dockerfile`
- `infra/compose.dev.yml`
- `infra/compose.yml`
- `package.json`
- `renovate.json`
- `scripts/clean-dev-fixtures.mjs`
- `scripts/gen-dev-env.mjs`
- `scripts/pg-major-upgrade.mjs`
- `scripts/smoke-auth-stack.mjs`

## Step 22: commit

```bash
git add -A
git commit -q -m "feat(infra): PostgreSQL 18 on a new volume with an upgrade script for the old one; Valkey with a required password; Caddy runs as its own user on 8080, keeps the API's headers, caches the page and the bundles by kind, caps bodies and drops a client's CF-Connecting-IP unless the tunnel is in front; cloudflared, Caddy, the API and the data services on separate networks; memory, process and log limits on every service; images pinned by digest and pnpm installed by corepack from its hash; CI reads only, builds the images and pins semgrep; the dev scripts refuse a remote Docker; the browser rule counts Origin, Sec-Fetch-Site and Sec-Fetch-Dest, not the bare Sec-Fetch-Mode that Node's fetch sends" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(infra): PostgreSQL 18 on a new volume with an upgrade script for the old one; Valkey with a required password; Caddy runs as its own user on 8080, keeps the API's headers, caches the page and the bundles by kind, caps bodies and drops a client's CF-Connecting-IP unless the tunnel is in front; cloudflared, Caddy, the API and the data services on separate networks; memory, process and log limits on every service; images pinned by digest and pnpm installed by corepack from its hash; CI reads only, builds the images and pins semgrep; the dev scripts refuse a remote Docker; the browser rule counts Origin, Sec-Fetch-Site and Sec-Fetch-Dest, not the bare Sec-Fetch-Mode that Node's fetch sends`.

## Report format (mandatory)

```text
TASK 8 REPORT
Files written: <count, expected 18>
Verify "typecheck": <paste the expected lines as printed>
Verify "dev-env": <paste the expected lines as printed>
Verify "compose-config": <paste the expected lines as printed>
Verify "stack-down": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "pg-upgrade": <paste the expected lines as printed>
Verify "stack-up": <paste the expected lines as printed>
Verify "postgres-version": <paste the expected lines as printed>
Verify "valkey-auth": <paste the expected lines as printed>
Verify "caddy-user": <paste the expected lines as printed>
Verify "page-headers": <paste the expected lines as printed>
Verify "api-headers": <paste the expected lines as printed>
Verify "bundle-headers": <paste the expected lines as printed>
Verify "body-limit": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "smoke": <paste the expected lines as printed>
Verify "remote-docker-refused": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "stack-stop": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
