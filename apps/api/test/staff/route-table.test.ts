import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { AuditEntry, AuditPage, CaseDecisionResponse, StaffEnrollVerifyResponse, StaffKey, StaffKeysResponse, StaffMe, StaffSession, StaffSessionsResponse } from "@korbat/contracts";
import { createDb } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createModeration } from "../../src/moderation";
import { createSocial, socialForModeration } from "../../src/social";
import { createStaff } from "../../src/staff";

const key = Buffer.alloc(32, 7).toString("base64");
const CONSOLE_ORIGIN = "http://console.localhost:8090";

interface RouteEntry {
  method: string;
  path: string;
}

/**
 * The real app with every module and the console on (3a design, section 11). The database pools are created but never
 * connect: only the route table is read. Returns the app and the staff module's own routes, as it would mount them.
 */
function build() {
  const config = loadConfig({
    DATABASE_URL_API: "postgres://a:b@localhost:55432/k",
    DATABASE_URL_AUTH: "postgres://a:b@localhost:55432/k",
    REDIS_URL: "redis://localhost:56379",
    APP_ORIGIN: "http://localhost:8081",
    AUTH_HMAC_KEY: key,
    IP_HASH_KEY: key,
    TOTP_ENC_KEY: `v1:${key}`,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    SMTP_URL: "smtp://localhost:1025",
    MAIL_FROM: "korbat <no-reply@korbat.local>",
    TERMS_VERSION: "draft-2026-09",
    CONSOLE_ORIGIN,
  });
  const logger = pino({ level: "silent" });
  const rateLimitStore = new MemoryStore();
  const auth = createAuth({
    config,
    logger,
    authDb: createDb(config.DATABASE_URL_AUTH, { max: 1 }),
    kv: new MemoryKv(),
    mailer: new MemoryMailer(),
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null, setVerified: async () => undefined },
  });
  const apiDb = createDb(config.DATABASE_URL_API, { max: 1 });
  const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, requireFreshAuth: auth.requireFreshAuth() });
  const mediaRoot = mkdtempSync(path.join(tmpdir(), "korbat-route-table-"));
  const media = createMedia({
    apiDb,
    uploadsDir: path.join(mediaRoot, "uploads"),
    storeDir: path.join(mediaRoot, "store"),
    formats: config.MEDIA_FORMATS,
    minFreeBytes: 0,
    logger,
    requireSession: auth.requireSession,
    resolveSession: auth.resolveSession,
    rateLimitStore,
    enforceUploadLimit: async () => undefined,
  });
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
  const moderation = createModeration({ apiDb, social: socialForModeration(apiDb), config, logger });
  const staff = createStaff({ apiDb, auth: auth.forStaff, moderation: moderation.forStaff });
  const app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account, staff });
  // What the staff module mounts at /api/staff, as createApp mounts it.
  const staffOwn = staff.routes(CONSOLE_ORIGIN).routes.map((r) => ({ method: r.method, path: `/api/staff${r.path}` }));
  return { app, staffOwn };
}

const isStaffPath = (p: string) => p === "/api/staff" || p.startsWith("/api/staff/");
const keyOf = (r: RouteEntry) => `${r.method} ${r.path}`;

/** Each method and path once, sorted: Hono lists a route once for every handler it chains. */
const distinct = (routes: RouteEntry[]) => [...new Set(routes.map(keyOf))].sort();

/**
 * A Hono path as a pattern: a parameter matches one segment, and a final wildcard the path itself and anything below it.
 * The app's paths hold only letters, digits, dashes, underscores and dots, so nothing else needs escaping.
 */
function patternOf(routePath: string): RegExp {
  const segments = routePath.split("/").map((segment) => {
    if (segment === "*") return ".*";
    if (segment.startsWith(":")) return "[^/]+";
    if (!/^[A-Za-z0-9_.-]*$/.test(segment)) throw new Error(`a path segment this check cannot read: ${segment}`);
    return segment.replaceAll(".", "[.]");
  });
  const last = segments.length - 1;
  // "/x/*" matches /x itself too, as Hono routes it.
  const body = segments[last] === ".*" ? `${segments.slice(0, last).join("/")}(/.*)?` : segments.join("/");
  return new RegExp(`^${body}$`);
}

/** A lower-case uuid, as a staff path's parameter (a session's handle, a case's id) takes one. */
const SAMPLE_PARAMETER = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";

/**
 * Paths under /api/staff a route of another module could answer, built from the staff module's own route table: each of
 * its paths with every parameter filled in, and each path that leads to one (/api/staff/signin for /signin/verify), so a
 * staff route added later is probed too; then the prefix itself, with a final slash, and a path the module does not have.
 * A foreign route that reaches one of them answers there for any method the staff module does not define, behind the gate
 * but with no app session, since createApp skips resolveSession on staff paths.
 */
function staffProbes(staffOwn: RouteEntry[]): string[] {
  const probes = new Set(["/api/staff", "/api/staff/", "/api/staff/x/y"]);
  for (const route of staffOwn) {
    if (!isStaffPath(route.path) || route.path.includes("*")) continue;
    const segments = route.path.split("/").map((segment) => (segment.startsWith(":") ? SAMPLE_PARAMETER : segment));
    for (let end = 3; end <= segments.length; end++) probes.add(segments.slice(0, end).join("/"));
  }
  return [...probes];
}

/**
 * The routes of the app that answer under /api/staff without being the staff module's own: every route not among those
 * the staff module mounts there (as many times as it mounts each) whose path lies under /api/staff or whose pattern
 * reaches a path there (staffProbes). The app's own chain,
 * registered on every path ("ALL /*"), is the one exception: request id, access log, client identity, headers and limits
 * apply to staff paths too (3a design, section 5).
 */
function foreignStaffRoutes(appRoutes: RouteEntry[], staffOwn: RouteEntry[]): string[] {
  const own = new Map<string, number>();
  for (const route of staffOwn) own.set(keyOf(route), (own.get(keyOf(route)) ?? 0) + 1);
  const probes = staffProbes(staffOwn);
  const foreign: string[] = [];
  for (const route of appRoutes) {
    const k = keyOf(route);
    if (k === "ALL /*") continue;
    const left = own.get(k) ?? 0;
    if (left > 0) {
      own.set(k, left - 1);
      continue;
    }
    const pattern = patternOf(route.path);
    if (isStaffPath(route.path) || probes.some((probe) => pattern.test(probe))) foreign.push(k);
  }
  return foreign;
}

/** A route path naming a role, a grant or a promotion: what a route that changes a role would be called. */
const ROLE_PATH = new RegExp("(^|/)(roles?|grants?|grant-role|promote|demote|make-staff|staff-role)(/|$)", "i");

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));
function sources(): { path: string; source: string }[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".ts") ? [full] : [];
    });
  return walk(SRC_ROOT).map((full) => ({ path: path.relative(SRC_ROOT, full).split(path.sep).join("/"), source: readFileSync(full, "utf8") }));
}

/**
 * Where an account's role may be changed: the repository's statements (changeRole for grant-role, setRole for the tests)
 * are reached only through grant-role's grantRole, which only the auth index (for the command line) and grant-role's own
 * command name. A route that changed a role would have to name one of them.
 */
const ROLE_WRITERS = /\b(changeRole|setRole|grantRole)\b/;
const ROLE_WRITER_FILES = new Set(["auth/repo.ts", "auth/admin.ts", "auth/index.ts", "cli/grant-role.ts"]);
const roleWriterViolations = (files: { path: string; source: string }[]) => files.filter((f) => !ROLE_WRITER_FILES.has(f.path) && ROLE_WRITERS.test(f.source)).map((f) => f.path);

/** A member of a staff answer that would name a person beyond their public handle: an address, a device, a phone or an account. */
const PERSONAL = /email|^ip|ipHash|address|device|phone|userId|accountId|actorId|userAgent|webauthn/i;

describe("the staff routes in the route table (3a design, section 11)", () => {
  test("are exactly the staff module's: the gate, sign-in, enrolment, the person's own reads, sign-out, step-up, the confirmed revocation and the confirmed decision", () => {
    const { app } = build();
    expect(distinct(app.routes.filter((r) => isStaffPath(r.path)))).toEqual(
      [
        "ALL /api/staff/*",
        "POST /api/staff/enroll/options",
        "POST /api/staff/enroll/verify",
        "POST /api/staff/signin/options",
        "POST /api/staff/signin/verify",
        "GET /api/staff/me",
        "GET /api/staff/sessions",
        "GET /api/staff/keys",
        "GET /api/staff/audit",
        "POST /api/staff/signout",
        "POST /api/staff/step-up/options",
        "DELETE /api/staff/sessions/:handle",
        "POST /api/staff/cases/:case/decisions",
      ].sort(),
    );
  });

  test("hold no route of another module under /api/staff", () => {
    const { app, staffOwn } = build();
    expect(staffOwn.length).toBeGreaterThan(0);
    // Every staff path is probed, the ones the old fixed list left out among them.
    const probes = staffProbes(staffOwn);
    for (const p of [
      "/api/staff/audit",
      "/api/staff/keys",
      "/api/staff/signout",
      "/api/staff/signin/options",
      "/api/staff/signin/verify",
      "/api/staff/enroll/options",
      "/api/staff/enroll/verify",
      `/api/staff/sessions/${SAMPLE_PARAMETER}`,
      "/api/staff/cases",
      `/api/staff/cases/${SAMPLE_PARAMETER}`,
      `/api/staff/cases/${SAMPLE_PARAMETER}/decisions`,
    ]) {
      expect(probes, p).toContain(p);
    }
    expect(foreignStaffRoutes(app.routes, staffOwn)).toEqual([]);
  });

  test("the check catches another module's route under /api/staff, a pattern that reaches it, and a second copy of a staff route", () => {
    const staffSub = new Hono();
    staffSub.use("*", async (_c, next) => next());
    staffSub.get("/me", (c) => c.text("staff"));
    staffSub.get("/audit", (c) => c.text("staff"));
    staffSub.get("/keys", (c) => c.text("staff"));
    staffSub.post("/signout", (c) => c.text("staff"));
    staffSub.post("/signin/verify", (c) => c.text("staff"));
    staffSub.post("/enroll/options", (c) => c.text("staff"));
    staffSub.delete("/sessions/:handle", (c) => c.text("staff"));
    const app = new Hono();
    app.use(async (_c, next) => next());
    app.route("/api/staff", staffSub);
    // As the social module is mounted at /api: a route of its own under /api/staff, ones whose parameter reaches a staff
    // path (with a method the staff module does not answer there, which would fall through to it), and a copy of a staff
    // route.
    const other = new Hono();
    other.get("/staff/extra", (c) => c.text("other"));
    other.get("/:section/me", (c) => c.text("other"));
    other.post("/:section/audit", (c) => c.text("other"));
    other.put("/:section/keys", (c) => c.text("other"));
    other.get("/:section/signout", (c) => c.text("other"));
    other.get("/:section/signin/verify", (c) => c.text("other"));
    other.get("/:section/enroll/:step", (c) => c.text("other"));
    other.get("/:section/sessions/:id", (c) => c.text("other"));
    other.get("/staff/me", (c) => c.text("other"));
    other.get("/profiles/:handle", (c) => c.text("other"));
    other.get("/:section/feed", (c) => c.text("other"));
    app.route("/api", other);
    const staffOwn = staffSub.routes.map((r) => ({ method: r.method, path: `/api/staff${r.path}` }));
    expect(foreignStaffRoutes(app.routes, staffOwn)).toEqual([
      "GET /api/staff/extra",
      "GET /api/:section/me",
      "POST /api/:section/audit",
      "PUT /api/:section/keys",
      "GET /api/:section/signout",
      "GET /api/:section/signin/verify",
      "GET /api/:section/enroll/:step",
      "GET /api/:section/sessions/:id",
      "GET /api/staff/me",
    ]);
  });

  test("no route changes a role: no path names one, and only grant-role's command line reaches the statements that do", () => {
    const { app } = build();
    expect(app.routes.filter((r) => ROLE_PATH.test(r.path)).map(keyOf)).toEqual([]);
    expect(roleWriterViolations(sources())).toEqual([]);
    // The rules catch a deliberate violation.
    expect(ROLE_PATH.test("/api/staff/users/:id/role")).toBe(true);
    expect(ROLE_PATH.test("/api/admin/grant")).toBe(true);
    expect(ROLE_PATH.test("/api/profiles/:handle")).toBe(false);
    expect(
      roleWriterViolations([
        { path: "staff/routes.ts", source: "routes.post('/x', (c) => auth.grantRole(email, 'admin'))" },
        { path: "auth/flows/x.ts", source: "await deps.repo.setRole(userId, 'admin');" },
        { path: "cli/grant-role.ts", source: "await grantRole(deps, email, role);" },
      ]),
    ).toEqual(["staff/routes.ts", "auth/flows/x.ts"]);
  });

  test("no route acts as another user or reads another user's sessions, email, IP, device or phone: no staff path names an account, and no staff answer has a member that would", () => {
    const { app } = build();
    // The path parameters under /api/staff are a staff session's handle, which the revocation takes only from the
    // person's own sessions (the step-up suites show another account's is not found), and a case's id: a case, never an
    // account.
    const parameters = distinct(app.routes.filter((r) => isStaffPath(r.path) && r.path.includes(":")));
    expect(parameters).toEqual(["DELETE /api/staff/sessions/:handle", "POST /api/staff/cases/:case/decisions"]);
    const answers = { StaffMe, StaffSession, StaffKey, AuditEntry, StaffSessionsResponse, StaffKeysResponse, AuditPage, StaffEnrollVerifyResponse, CaseDecisionResponse };
    const members = Object.entries(answers).flatMap(([name, schema]) => Object.keys(schema.shape).map((member) => `${name}.${member}`));
    expect(members.filter((member) => PERSONAL.test(member.split(".")[1]!))).toEqual([]);
    // The browser's coarse label and the actor's public handle are what the console shows of a session and a row.
    expect(members).toContain("StaffSession.browser");
    expect(members).toContain("AuditEntry.actorHandle");
    expect(PERSONAL.test("email")).toBe(true);
    expect(PERSONAL.test("ipHash")).toBe(true);
    expect(PERSONAL.test("deviceId")).toBe(true);
  });
});
