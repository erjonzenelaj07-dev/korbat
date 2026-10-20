import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  AppealsPage,
  AuditEntry,
  AuditPage,
  CaseView,
  ContactPage,
  FindingResponse,
  OrderView,
  OrdersPage,
  RestoreView,
  QueuePage,
  RevealResponse,
  StaffEnrollVerifyResponse,
  StaffKey,
  StaffKeysResponse,
  StaffMe,
  StaffOverview,
  StandingLists,
  StaffSession,
  StaffSessionsResponse,
  StaffSnapshotTaken,
  StaffTextSaved,
  StaffTextsResponse,
} from "@korbat/contracts";
import { createDb } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth, type AuthForStaff } from "../../src/auth";
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
    NOTIFIER_ENC_KEY: `v1:${key}`,
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
    profiles: { create: async () => ({ ok: false, reason: "handle_taken" }), find: async () => null, setVerified: async () => true, suspended: async () => false },
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
  const moderation = createModeration({ apiDb, auth: auth.forModeration, social: socialForModeration(apiDb), media: media.forCases, rateLimitStore, config, logger });
  // The staff module gets the auth module's two guards with a mark on each, so the table can be read for which route
  // stands behind which: the session guard, and the step-up of one action.
  const guards = new Map<unknown, string>();
  const marked = <T>(guard: T, mark: string): T => {
    guards.set(guard, mark);
    return guard;
  };
  // The session guard also counts its runs, so a test can tell a request that reached it from one answered before it.
  const runs = { session: 0 };
  const countedRequireStaff: AuthForStaff["requireStaff"] = async (c, next) => {
    runs.session++;
    return auth.forStaff.requireStaff(c, next);
  };
  const forStaff: AuthForStaff = {
    ...auth.forStaff,
    requireStaff: marked(countedRequireStaff, "session"),
    requireStaffStepUp: (action, target) => marked(auth.forStaff.requireStaffStepUp(action, target), `step-up:${action}`),
  };
  const staff = createStaff({ apiDb, auth: forStaff, moderation: moderation.forStaff });
  const app = createApp({ config, logger, rateLimitStore, healthChecks: {}, auth, social, media, account, staff, moderation });
  // What the staff module mounts at /api/staff, as createApp mounts it.
  const mounted = staff.routes(CONSOLE_ORIGIN).routes;
  const staffOwn = mounted.map((r) => ({ method: r.method, path: `/api/staff${r.path}` }));
  // Each staff route with the guards in its chain: Hono lists a route once for every handler it chains.
  const guarded = new Map<string, string[]>();
  for (const r of mounted) {
    const route = `${r.method} /api/staff${r.path}`;
    const mark = guards.get(r.handler);
    guarded.set(route, [...(guarded.get(route) ?? []), ...(mark === undefined ? [] : [mark])]);
  }
  return { app, staffOwn, guarded, runs };
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

/** What memberNames writes in place of the members of a schema whose kind it cannot read. */
const UNREAD = "a member of a kind this check cannot read";

/**
 * Every member of an answer's schema by its path, through objects, lists, unions and nullable or optional members, so a
 * member inside a case's items or a seal's list is read as one at the top is. A kind of schema this walk does not know
 * is listed as such (UNREAD), and the test below refuses any: whatever such a member holds would otherwise go unread.
 *
 * The walk reads the contracts, not the answers. That an answer holds nothing but what its contract names is held by the
 * HTTP suites, which compare each raw answer with what its schema reads from it (http-staff-cases.test.ts).
 */
function memberNames(schema: unknown, path = ""): string[] {
  const def = (schema as { _zod: { def: Record<string, unknown> } })._zod.def;
  switch (def.type) {
    case "object":
      return Object.entries(def.shape as Record<string, unknown>).flatMap(([key, member]) => {
        const name = path === "" ? key : `${path}.${key}`;
        return [name, ...memberNames(member, name)];
      });
    case "array":
      return memberNames(def.element, path);
    case "union":
      return [...new Set((def.options as unknown[]).flatMap((option) => memberNames(option, path)))];
    case "nullable":
    case "optional":
      return memberNames(def.innerType, path);
    case "string":
    case "number":
    case "boolean":
    case "enum":
    case "literal":
      return [];
    default:
      return [`${path}: ${UNREAD} (${String(def.type)})`];
  }
}

describe("the staff routes in the route table (3a design, section 11)", () => {
  test("are exactly the staff module's: the gate, sign-in, enrolment, the person's own reads, sign-out, step-up, the confirmed revocation, the confirmed decision and review, and the console's reads and writes on cases and appeals", () => {
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
        "GET /api/staff/appeals",
        "POST /api/staff/decisions/:decision/review",
        "GET /api/staff/overview",
        "GET /api/staff/queue",
        "GET /api/staff/standing",
        "GET /api/staff/cases/:case",
        "GET /api/staff/cases/:case/media/:media/:size",
        "POST /api/staff/cases/:case/snapshots",
        "POST /api/staff/findings",
        "POST /api/staff/cases/:case/texts",
        "GET /api/staff/cases/:case/texts",
        "POST /api/staff/items/:item/reveal",
        // 3f: the authorities' contact point.
        "GET /api/staff/contact",
        "POST /api/staff/contact/:message/close",
        // 3f, Task 2: order records.
        "GET /api/staff/orders",
        "GET /api/staff/orders/:order",
        "POST /api/staff/orders",
        "POST /api/staff/orders/:order/items",
        "POST /api/staff/orders/:order/events",
        "POST /api/staff/orders/:order/correct",
        // Task 3: giving effect.
        "POST /api/staff/orders/:order/effect",
        // Task 6: recovery: the keeper's download and its mark, what a restore lost and a gap closed as not needed.
        "POST /api/staff/audit/export",
        "POST /api/staff/audit/export/mark",
        "GET /api/staff/restore",
        "POST /api/staff/restore/gaps/:gap/close",
        // 3d Task 2: an admin's release of a seal for good.
        "POST /api/staff/seals/:action/release",
      ].sort(),
    );
  });

  test("every staff route that changes something asks for the key, but the named exceptions: enrolment, sign-in, the step-up's own options, sign-out, and saving a text, taking a snapshot and opening a finding", () => {
    const { guarded } = build();
    const changing = [...guarded].filter(([route]) => !route.startsWith("GET ") && !route.startsWith("ALL "));
    const stepUps = Object.fromEntries(changing.flatMap(([route, marks]) => marks.filter((mark) => mark.startsWith("step-up:")).map((mark) => [route, mark.slice("step-up:".length)])));
    // Each confirmed route, with the one action its key confirms.
    expect(stepUps).toEqual({
      "DELETE /api/staff/sessions/:handle": "staff_session_revoked",
      "POST /api/staff/cases/:case/decisions": "case_decided",
      "POST /api/staff/decisions/:decision/review": "appeals_reviewed",
      "POST /api/staff/items/:item/reveal": "identity_revealed",
      // 3f, Task 2: an order's clock event, closing, reopening or extension.
      "POST /api/staff/orders/:order/events": "order_event_recorded",
      // Task 3: "Disable for an order".
      "POST /api/staff/orders/:order/effect": "order_effected",
      // Task 6: the audit log's download, and a gap closed as not needed.
      "POST /api/staff/audit/export": "audit_exported",
      "POST /api/staff/restore/gaps/:gap/close": "gap_closed",
      // 3d Task 2: the release of a seal for good.
      "POST /api/staff/seals/:action/release": "seal_released",
    });
    // The changing routes without a step-up, by method and path: 3a's four kinds, and the three of moderation cases,
    // none of which changes anything a user sees (3c design, section 2, Free text under the step-up).
    const unconfirmed = changing.filter(([route]) => !(route in stepUps)).map(([route]) => route);
    expect(unconfirmed.sort()).toEqual(
      [
        "POST /api/staff/enroll/options",
        "POST /api/staff/enroll/verify",
        "POST /api/staff/signin/options",
        "POST /api/staff/signin/verify",
        "POST /api/staff/step-up/options",
        "POST /api/staff/signout",
        "POST /api/staff/cases/:case/texts",
        "POST /api/staff/cases/:case/snapshots",
        "POST /api/staff/findings",
        // 3f: closing a message at the contact point restricts nothing and tells nobody (design, section 7.3).
        "POST /api/staff/contact/:message/close",
        // 3f, Task 2: opening an order and adding its links restrict nothing, copy nothing and tell nobody (section 7.4). A
        // correction asks for the key only under the rule admin, which the database decides after effect: the route takes
        // the step-up of order_corrected when the body carries one, and answers staff_step_up_required under that rule
        // without one (http-staff-orders proves both), so its chain holds no step-up of its own.
        "POST /api/staff/orders",
        "POST /api/staff/orders/:order/items",
        "POST /api/staff/orders/:order/correct",
        // Task 6: the mark shows nothing, and can only say "I hold it" of a file a key released (section 7.16).
        "POST /api/staff/audit/export/mark",
      ].sort(),
    );
    // Every route stands behind the staff session but enrolment and sign-in, whose credential is the link or the key.
    const open = [...guarded].filter(([route, marks]) => !route.startsWith("ALL ") && !marks.includes("session")).map(([route]) => route);
    expect(open.sort()).toEqual(["POST /api/staff/enroll/options", "POST /api/staff/enroll/verify", "POST /api/staff/signin/options", "POST /api/staff/signin/verify"]);
    // And a step-up always follows the session guard, once.
    for (const [route, marks] of guarded) if (route in stepUps) expect(marks, route).toEqual(["session", `step-up:${stepUps[route]}`]);
  });

  test("no staff route answers HEAD: on every path of the staff module a HEAD from the console's own host is the unknown route, with no body, and no session guard runs for it", async () => {
    const { app, staffOwn, runs } = build();
    const host = new URL(CONSOLE_ORIGIN).host;
    // Every GET route of the module with its parameters filled in: an id, and for the image route a size it takes.
    const fill = (routePath: string) => routePath.split("/").map((segment) => (segment === ":size" ? "small" : segment.startsWith(":") ? SAMPLE_PARAMETER : segment)).join("/");
    const reads = [...new Set(staffOwn.filter((r) => r.method === "GET").map((r) => fill(r.path)))];
    expect(reads).toEqual(expect.arrayContaining(["/api/staff/me", "/api/staff/sessions", "/api/staff/audit", "/api/staff/overview", "/api/staff/queue", `/api/staff/cases/${SAMPLE_PARAMETER}`, `/api/staff/cases/${SAMPLE_PARAMETER}/media/${SAMPLE_PARAMETER}/small`]));
    // Hono would answer a HEAD with the GET route's handlers and drop the body: none of them may run.
    const others = ["/api/staff", "/api/staff/signout", "/api/staff/findings", `/api/staff/cases/${SAMPLE_PARAMETER}/snapshots`, "/api/staff/no/such/path"];
    for (const p of [...reads, ...others]) {
      const res = await app.request(`${CONSOLE_ORIGIN}${p}`, { method: "HEAD", headers: { host } });
      expect(res.status, p).toBe(404);
      expect(await res.text(), p).toBe("");
    }
    expect(runs.session).toBe(0);
    // The same paths with GET do reach the session guard, which refuses a request that carries no staff cookie.
    for (const p of reads) {
      const res = await app.request(`${CONSOLE_ORIGIN}${p}`, { headers: { host } });
      expect(res.status, p).toBe(401);
    }
    expect(runs.session).toBe(reads.length);
    // A HEAD that fails the gate gets the gate's own answer, as every method does: the gate still stands first.
    expect((await app.request(`${CONSOLE_ORIGIN}/api/staff/overview`, { method: "HEAD", headers: { host: "localhost:8081" } })).status).toBe(404);
    expect((await app.request(`${CONSOLE_ORIGIN}/api/staff/overview`, { method: "HEAD", headers: { host, origin: "http://localhost:8081" } })).status).toBe(403);
    expect((await app.request(`${CONSOLE_ORIGIN}/api/staff/overview`, { method: "HEAD", headers: { host, "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect(runs.session).toBe(reads.length);
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
      "/api/staff/overview",
      "/api/staff/queue",
      "/api/staff/findings",
      `/api/staff/cases/${SAMPLE_PARAMETER}/texts`,
      `/api/staff/cases/${SAMPLE_PARAMETER}/snapshots`,
      `/api/staff/cases/${SAMPLE_PARAMETER}/media`,
      `/api/staff/cases/${SAMPLE_PARAMETER}/media/${SAMPLE_PARAMETER}`,
      `/api/staff/cases/${SAMPLE_PARAMETER}/media/${SAMPLE_PARAMETER}/${SAMPLE_PARAMETER}`,
      "/api/staff/items",
      `/api/staff/items/${SAMPLE_PARAMETER}/reveal`,
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
    // person's own sessions (the step-up suites show another account's is not found), a case's id, an image's id with its
    // size, an item's id and a decision's id: a case, an image of its post, an item of a notice and the decision an appeal
    // is about, never an account.
    const parameters = distinct(app.routes.filter((r) => isStaffPath(r.path) && r.path.includes(":")));
    expect(parameters).toEqual([
      "DELETE /api/staff/sessions/:handle",
      "GET /api/staff/cases/:case",
      "GET /api/staff/cases/:case/media/:media/:size",
      "GET /api/staff/cases/:case/texts",
      // 3f: an order (Task 2).
      "GET /api/staff/orders/:order",
      "POST /api/staff/cases/:case/decisions",
      "POST /api/staff/cases/:case/snapshots",
      "POST /api/staff/cases/:case/texts",
      // 3f: a message at the contact point.
      "POST /api/staff/contact/:message/close",
      "POST /api/staff/decisions/:decision/review",
      "POST /api/staff/items/:item/reveal",
      "POST /api/staff/orders/:order/correct",
      "POST /api/staff/orders/:order/effect",
      "POST /api/staff/orders/:order/events",
      "POST /api/staff/orders/:order/items",
      // 3f Task 6: a restore gap.
      "POST /api/staff/restore/gaps/:gap/close",
      // 3d Task 2: a seal, by its ledger row.
      "POST /api/staff/seals/:action/release",
    ]);
    const answers = {
      StaffMe,
      StaffSession,
      StaffKey,
      AuditEntry,
      StaffSessionsResponse,
      StaffKeysResponse,
      AuditPage,
      StaffEnrollVerifyResponse,
      StaffOverview,
      QueuePage,
      CaseView,
      StaffTextSaved,
      StaffTextsResponse,
      StaffSnapshotTaken,
      FindingResponse,
      RevealResponse,
      AppealsPage,
      StandingLists,
      ContactPage,
      OrdersPage,
      OrderView,
      // 3f Task 6.
      RestoreView,
    };
    const members = Object.entries(answers).flatMap(([name, schema]) => memberNames(schema).map((member) => `${name}.${member}`));
    // The walk read every member of every answer: none is of a kind it has not been taught, behind which a name could hide.
    expect(members.filter((member) => member.includes(UNREAD))).toEqual([]);
    expect(members.filter((member) => PERSONAL.test(member.split(".").at(-1)!))).toEqual([]);
    // Both checks catch a deliberate violation: a member of an unread kind is listed as one, at the top or inside a list,
    // and a personal member inside one is then not seen, which is why none may be left.
    const unread = memberNames(z.object({ when: z.date(), rows: z.array(z.object({ byId: z.record(z.string(), z.object({ email: z.string() })) })) }));
    expect(unread).toEqual(["when", `when: ${UNREAD} (date)`, "rows", "rows.byId", `rows.byId: ${UNREAD} (record)`]);
    expect(unread.filter((member) => member.includes(UNREAD))).toHaveLength(2);
    expect(unread.filter((member) => PERSONAL.test(member.split(".").at(-1)!))).toEqual([]);
    // The walk reaches the members inside lists, unions and nullable members: a source's summary, a seal's list, a snapshot.
    expect(members).toContain("CaseView.items.source.contactLost");
    expect(members).toContain("CaseView.decisions.actions.sealed.list.postId");
    expect(members).toContain("CaseView.snapshots.authorHandle");
    expect(members).toContain("CaseView.target.displayName");
    expect(members).toContain("StaffOverview.reveals.items.handle");
    // The appeals: the list's rows and the case's appeals carry the marks of their review, and the list no statement.
    expect(members).toContain("AppealsPage.appeals.mayReview");
    expect(members).toContain("CaseView.appeals.needsAdmin");
    expect(members).toContain("StaffOverview.appealsWithoutReviewer");
    expect(members.filter((member) => member.startsWith("AppealsPage.") && /statement|appellant/i.test(member))).toEqual([]);
    // 3e Task 4: the queue's replies and the Standing screen's lists carry no text and name people by their handles only.
    expect(members).toContain("QueuePage.replies.onTime");
    expect(members.filter((member) => member.startsWith("QueuePage.replies.") && /text|statement/i.test(member))).toEqual([]);
    expect(members).toContain("StandingLists.terminationsWaiting.items.handle");
    expect(members).toContain("StaffOverview.repliesWaiting.count");
    // People are handles and a source is a summary: no answer has a member for a reporter, a notifier or a contact.
    // 3f's StaffOverview.contact is the authorities' contact point's counts, not a person's contact.
    expect(members.filter((member) => member !== "StaffOverview.contact" && /[.](reporter|notifier|contact)(Id)?$/i.test(member))).toEqual([]);
    expect(members).toContain("ContactPage.items.handledBy");
    expect(members.filter((member) => member.startsWith("ContactPage.") && /sender|subject|from|address|body/i.test(member))).toEqual([]);
    expect(memberNames(z.object({ list: z.array(z.object({ inner: z.object({ email: z.string() }).nullable() })) }))).toEqual(["list", "list.inner", "list.inner.email"]);
    // The browser's coarse label and the actor's public handle are what the console shows of a session and a row.
    expect(members).toContain("StaffSession.browser");
    expect(members).toContain("AuditEntry.actorHandle");
    expect(PERSONAL.test("email")).toBe(true);
    expect(PERSONAL.test("ipHash")).toBe(true);
    expect(PERSONAL.test("deviceId")).toBe(true);
  });
});
