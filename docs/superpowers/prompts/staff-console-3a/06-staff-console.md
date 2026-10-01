# korbat staff console (3a) — Task 6 of 9: The staff console: apps/admin as a React page built by esbuild with plain CSS and jitless zod, its router, fetch wrappers and screens (sign-in, enrolment, home, the audit log, the console off), the check of step-up options before the key is asked, the idle timer bounded by the absolute end, the development server with the console site's headers, the development settings, and CI building it

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-30 and 2026-10-01 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Tasks 1 to 5 built the whole API side of the staff console: the record, enrolment, sign-in, staff sessions and step-up. This task builds the console itself in `apps/admin`: a plain React page bundled by esbuild, its screens, its check of step-up options, its idle timer, and its development server. The design is `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md` (sections 3 and 9).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api,contracts): step-up: an action that changes something asks for an assertion from the session's own staff key over a 74-byte challenge bound to the session's handle and the sorted-JSON hash of the action, its target and its parameters, spent once and read only while more than a minute of its ten is left; the route recomputes the hash from what it is about to do, re-checks the key and the account under the account's lock, and writes its record with the assertion in the same transaction; DELETE /api/staff/sessions/:handle is the first such action and takes only a lower-case handle, so the record hashes what was confirmed; audit-verify checks every confirmation against the key's public key, the origin and relying party recorded on it and the row's actor, and that no step-up action's row lacks one; no route changes a role or reads another person's data`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/06-staff-console.md 1
```

Expected: 15 lines starting with `wrote`, one for each file below.

### Create `apps/admin/test/api.test.ts`

```ts
import { StaffErrorCode } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { ApiError, createStaffApi, readCookie } from "../src/api";
import { describeError, messageFor, STAFF_MESSAGES } from "../src/messages";
import { envelope, fakeFetch, makeMe, revokeAction, SESSION_HANDLE } from "./fixtures";

const CSRF = "__Host-korbat_staff_csrf";

/** An API client over a fake fetch, with the hooks the store sets recorded. */
function client(table: Parameters<typeof fakeFetch>[0], cookie = `__Host-korbat_csrf=app-token; ${CSRF}=staff-token`) {
  const fake = fakeFetch(table);
  const api = createStaffApi({ fetch: fake.fetch, cookie: () => cookie });
  const events: string[] = [];
  api.hooks.onSessionRequired = (carriedStaffCookie) => events.push(`session-required ${carriedStaffCookie ? "with" : "without"} the staff cookie`);
  api.hooks.onActivity = () => events.push("activity");
  return { api, requests: fake.requests, events };
}

describe("the fetch wrapper", () => {
  test("sends the activity mark only when the caller asks for it", async () => {
    const { api, requests } = client({ "GET /api/staff/me": { status: 200, body: makeMe() } });
    await api.me({ activity: true });
    await api.me({ activity: false });
    await api.me();
    expect(requests.map((r) => r.headers["x-staff-activity"])).toEqual(["1", undefined, undefined]);
  });

  test("echoes the staff CSRF cookie in x-staff-csrf, never the app's, and never the app's header", async () => {
    const { api, requests } = client({ "POST /api/staff/signout": { status: 204 } });
    await api.signOut({ activity: true });
    expect(requests[0]!.headers["x-staff-csrf"]).toBe("staff-token");
    expect(requests[0]!.headers["x-csrf-token"]).toBeUndefined();
    expect(requests[0]!.headers.authorization).toBeUndefined();
  });

  test("sends no CSRF header while there is no staff CSRF cookie", async () => {
    const { api, requests } = client({ "POST /api/staff/signin/options": { status: 200, body: { options: { challenge: "abc" } } } }, "__Host-korbat_csrf=app-token");
    await api.signInOptions({ activity: true });
    expect(requests[0]!.headers["x-staff-csrf"]).toBeUndefined();
  });

  test("reads a cookie by its exact name", () => {
    expect(readCookie(`a=1; ${CSRF}x=2; ${CSRF}=3`, CSRF)).toBe("3");
    expect(readCookie("", CSRF)).toBeUndefined();
    expect(readCookie(`${CSRF}=a%20b`, CSRF)).toBe("a b");
  });

  test("every request goes to its own path on the console's origin, with JSON bodies", async () => {
    const { api, requests } = client({
      "DELETE /api/staff/sessions/7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36": { status: 204 },
      "POST /api/staff/step-up/options": { status: 200, body: { options: { challenge: "abc" } } },
    });
    const action = revokeAction("7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36");
    await api.stepUpOptions(action, { activity: true });
    const stepUp = { id: "aWQ", rawId: "aWQ", type: "public-key" as const, response: { clientDataJSON: "Y2Q", authenticatorData: "YWQ", signature: "c2c" }, clientExtensionResults: {} };
    await api.revokeSession("7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36", { stepUp }, { activity: true });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/staff/step-up/options", "DELETE /api/staff/sessions/7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36"]);
    expect(requests[0]!.body).toEqual(action);
    expect(requests[0]!.headers["content-type"]).toBe("application/json");
    expect(requests[1]!.body).toEqual({ stepUp });
  });

  test("the audit reader's query: the filter, a cursor or a place", async () => {
    const page = { entries: [], nextCursor: null };
    const { api, requests } = client({
      "GET /api/staff/audit": { status: 200, body: page },
      "GET /api/staff/audit?cursor=51": { status: 200, body: page },
      "GET /api/staff/audit?at=7": { status: 200, body: page },
      "GET /api/staff/audit?action=staff_sign_in&cursor=9": { status: 200, body: page },
    });
    await api.audit({});
    await api.audit({ cursor: 51 });
    await api.audit({ at: 7 });
    await api.audit({ action: "staff_sign_in", cursor: 9 });
    expect(requests.map((r) => r.url)).toEqual(["/api/staff/audit", "/api/staff/audit?cursor=51", "/api/staff/audit?at=7", "/api/staff/audit?action=staff_sign_in&cursor=9"]);
  });

  test("every answer is parsed with the contracts' schemas", async () => {
    const { api } = client({
      "GET /api/staff/me": { status: 200, body: { ...makeMe(), role: "user" } },
      "GET /api/staff/keys": { status: 200, body: { keys: [{ id: "not-a-uuid", name: "k", createdAt: "2026-10-01T09:00:00.000Z", lastUsedAt: null }] } },
      "GET /api/staff/sessions": { status: 200, body: { sessions: [] } },
    });
    // A role that opens no console, and a key whose id is no uuid, are not answers the console can show.
    await expect(api.me()).rejects.toMatchObject({ code: "invalid_answer" });
    await expect(api.keys()).rejects.toMatchObject({ code: "invalid_answer" });
    await expect(api.sessions()).resolves.toEqual({ sessions: [] });
  });

  test("an answer that is not JSON is no answer either", async () => {
    const api = createStaffApi({ fetch: async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }), cookie: () => "" });
    await expect(api.me()).rejects.toMatchObject({ code: "invalid_answer" });
  });

  test("an error answer becomes an ApiError with the server's code and the console's own words", async () => {
    const { api } = client({ "POST /api/staff/signin/verify": { status: 403, body: envelope("staff_key_not_device_bound", "<b>the server's words</b>") } });
    const response = { id: "aWQ", rawId: "aWQ", type: "public-key" as const, response: { clientDataJSON: "Y2Q", authenticatorData: "YWQ", signature: "c2c" }, clientExtensionResults: {} };
    const err = await api.signInVerify({ response }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "staff_key_not_device_bound", message: STAFF_MESSAGES.staff_key_not_device_bound });
  });

  test("a 404 without an envelope is not_found, a failed fetch is network, anything else unknown is internal", async () => {
    const notFound = createStaffApi({ fetch: async () => new Response("Not Found", { status: 404 }), cookie: () => "" });
    await expect(notFound.me()).rejects.toMatchObject({ status: 404, code: "not_found" });
    const down = createStaffApi({ fetch: async () => Promise.reject(new TypeError("Failed to fetch")), cookie: () => "" });
    await expect(down.me()).rejects.toMatchObject({ status: 0, code: "network" });
    const broken = createStaffApi({ fetch: async () => new Response("oops", { status: 502 }), cookie: () => "" });
    await expect(broken.me()).rejects.toMatchObject({ status: 502, code: "internal" });
  });

  test("staff_session_required calls the session hook, whichever request answered it", async () => {
    const { api, events } = client({ "GET /api/staff/keys": { status: 401, body: envelope("staff_session_required") } });
    await expect(api.keys({ activity: true })).rejects.toMatchObject({ code: "staff_session_required" });
    expect(events).toEqual(["session-required with the staff cookie"]);
  });

  test("the session hook is told whether the refused request carried the staff CSRF cookie, read before it was sent", async () => {
    // The answer clears the cookie, so only what the request carried can say that a sign-in had set it.
    let cookie = `${CSRF}=staff-token`;
    const fake = fakeFetch({
      "GET /api/staff/me": () => {
        cookie = "";
        return { status: 401, body: envelope("staff_session_required") };
      },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => cookie });
    const told: boolean[] = [];
    api.hooks.onSessionRequired = (carriedStaffCookie) => told.push(carriedStaffCookie);
    await api.me({ activity: true }).catch(() => undefined);
    await api.me({ activity: true }).catch(() => undefined);
    expect(told).toEqual([true, false]);
  });

  test("the activity hook runs after a marked request succeeds, and after no other", async () => {
    const { api, events } = client({
      "GET /api/staff/me": [{ status: 200, body: makeMe() }, { status: 200, body: makeMe() }, { status: 403, body: envelope("csrf_failed") }],
    });
    await api.me({ activity: false });
    expect(events).toEqual([]);
    await api.me({ activity: true });
    expect(events).toEqual(["activity"]);
    await expect(api.me({ activity: true })).rejects.toMatchObject({ code: "csrf_failed" });
    expect(events).toEqual(["activity"]);
  });

  test("a session revocation answers nothing on success", async () => {
    const { api } = client({ [`DELETE /api/staff/sessions/${SESSION_HANDLE}`]: { status: 204 } });
    const stepUp = { id: "aWQ", rawId: "aWQ", type: "public-key" as const, response: { clientDataJSON: "Y2Q", authenticatorData: "YWQ", signature: "c2c" }, clientExtensionResults: {} };
    await expect(api.revokeSession(SESSION_HANDLE, { stepUp })).resolves.toBeUndefined();
  });
});

describe("the console's words", () => {
  test("every staff code has the design's sentence", () => {
    expect(STAFF_MESSAGES).toEqual({
      staff_session_required: "Your staff session ended. Sign in with your staff key.",
      staff_key_invalid: "This key does not open the staff console. If it should, ask the operator to check your staff keys.",
      staff_key_suspended: "This staff key was switched off because a copy of it may exist. Ask the operator for a link to enrol a new one.",
      staff_key_limit: "This account has 5 staff keys. Ask the operator to revoke one before enrolling another.",
      staff_key_not_device_bound: "This key can be synced or copied, so it cannot be a staff key. Use a security key or a device-bound authenticator.",
      staff_key_not_user_verified: "This key did not ask for a PIN or fingerprint, so it cannot be a staff key. Set a PIN on it, or use another key.",
      staff_key_refused: "The browser's answer for this key could not be checked. Try again, or use another key; this link still works.",
      staff_enrollment_invalid: "This enrolment link has expired or was already used. Ask the operator for a new one.",
      staff_step_up_required: "Confirm this with your staff key.",
      staff_step_up_invalid: "That confirmation was for another action, was already used or could not be checked. Try again.",
    });
    expect(Object.keys(STAFF_MESSAGES).sort()).toEqual([...StaffErrorCode.options].sort());
  });

  test("the shared codes a staff route may answer have words of their own", () => {
    for (const code of ["challenge_expired", "rate_limited", "invalid_request", "not_found", "csrf_failed", "internal", "network", "invalid_answer"]) {
      expect(messageFor(code), code).not.toBe(messageFor("no_such_code"));
    }
  });

  test("never a passkey_* text, which sends people to the app's remedies", () => {
    for (const code of ["passkey_invalid", "passkey_unsupported", "passkey_suspended", "passkey_limit"]) {
      expect(messageFor(code)).toBe(messageFor("no_such_code"));
    }
    expect(messageFor("no_such_code")).not.toMatch(/passkey/i);
  });

  test("the server's own message is never shown", () => {
    expect(describeError(new ApiError(403, "staff_key_invalid", "<b>the server's words</b>"))).toBe(STAFF_MESSAGES.staff_key_invalid);
    expect(describeError(new Error("<b>anything</b>"))).toBe(messageFor("no_such_code"));
  });
});
```

### Create `apps/admin/test/audit-log.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import { createAuditReader, parsePlace } from "../src/audit-log";
import { fakeFetch } from "./fixtures";

/**
 * The audit log's reading (3a design, section 9): the newest page, "Load older" from the page's cursor, and "Go to place",
 * which opens the page whose newest row is at a place the keeper kept.
 */
const entry = (seq: number) => ({
  seq,
  hash: seq.toString(16).padStart(64, "0"),
  createdAt: "2026-10-01T09:00:00.000Z",
  actorHandle: "mod_anna",
  action: "staff_sign_in",
  targetType: "staff_session",
  targetId: "2b7c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
  actionHash: null,
});

describe("a place the keeper kept", () => {
  test("a positive whole number, as the reader's query takes it", () => {
    expect(parsePlace("1")).toBe(1);
    expect(parsePlace(" 1234 ")).toBe(1234);
    expect(parsePlace("999999999999999")).toBe(999_999_999_999_999);
  });

  test("anything else asks nothing of the API", () => {
    for (const text of ["", "0", "-1", "01", "1.5", "1e3", "abc", "1234567890123456", "12 34"]) expect(parsePlace(text), text).toBeNull();
  });
});

describe("the audit log's pages", () => {
  test("newest, older from the cursor, and Go to place, each marked as its person's action", async () => {
    const fake = fakeFetch({
      "GET /api/staff/audit": { status: 200, body: { entries: [entry(120), entry(119)], nextCursor: 119 } },
      "GET /api/staff/audit?cursor=119": { status: 200, body: { entries: [entry(118)], nextCursor: null } },
      "GET /api/staff/audit?at=7": { status: 200, body: { entries: [entry(7), entry(6)], nextCursor: 6 } },
    });
    const reader = createAuditReader(createStaffApi({ fetch: fake.fetch, cookie: () => "" }));
    const newest = await reader.newest();
    expect(newest.entries.map((e) => e.seq)).toEqual([120, 119]);
    const older = await reader.older(newest.nextCursor!);
    expect(older.entries.map((e) => e.seq)).toEqual([118]);
    const at = await reader.at(7);
    expect(at.entries.map((e) => e.seq)).toEqual([7, 6]);
    expect(fake.requests.map((r) => `${r.url} ${r.headers["x-staff-activity"]}`)).toEqual(["/api/staff/audit 1", "/api/staff/audit?cursor=119 1", "/api/staff/audit?at=7 1"]);
  });

  test("an answer with more rows than a page, or a hash that is not one, is refused", async () => {
    const fake = fakeFetch({
      "GET /api/staff/audit": { status: 200, body: { entries: Array.from({ length: 51 }, (_, i) => entry(200 - i)), nextCursor: 149 } },
      "GET /api/staff/audit?at=1": { status: 200, body: { entries: [{ ...entry(1), hash: "<b>x</b>" }], nextCursor: null } },
    });
    const reader = createAuditReader(createStaffApi({ fetch: fake.fetch, cookie: () => "" }));
    await expect(reader.newest()).rejects.toMatchObject({ code: "invalid_answer" });
    await expect(reader.at(1)).rejects.toMatchObject({ code: "invalid_answer" });
  });
});
```

### Create `apps/admin/test/build.test.ts`

```ts
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildConsole, buildOptions, BUILD_TARGET } from "../build.mjs";

/**
 * The build (3a design, section 9): esbuild called directly, its target pinned, minified, the bundle and the stylesheet
 * under hashed names, and dist/index.html referencing them with no inline script or style, which the page's policy would
 * refuse.
 */
let out = "";

beforeAll(async () => {
  out = mkdtempSync(path.join(tmpdir(), "korbat-admin-build-"));
  await buildConsole({ outdir: out });
}, 60_000);

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe("the console's build", () => {
  test("pins its target, and esbuild is given exactly that target and told to minify", () => {
    expect(BUILD_TARGET.length).toBeGreaterThan(0);
    for (const target of BUILD_TARGET) expect(target).toMatch(/^(chrome|edge|firefox|safari)\d+$/);
    // The options the build and the development server hand esbuild. The list above pins nothing unless they carry it:
    // without `target` esbuild writes for its own default, which a new esbuild may change.
    const options = buildOptions(out);
    expect(options.target).toEqual(BUILD_TARGET);
    expect(options.minify).toBe(true);
  });

  test("writes a hashed bundle and stylesheet, and index.html naming exactly them", () => {
    const assets = readdirSync(path.join(out, "assets")).sort();
    const script = assets.find((file) => /^main-[A-Z0-9]{8}\.js$/.test(file));
    const style = assets.find((file) => /^main-[A-Z0-9]{8}\.css$/.test(file));
    expect(script, assets.join(", ")).toBeDefined();
    expect(style, assets.join(", ")).toBeDefined();
    const index = readFileSync(path.join(out, "index.html"), "utf8");
    expect(index).toContain(`<script type="module" src="/assets/${script}"></script>`);
    expect(index).toContain(`<link rel="stylesheet" href="/assets/${style}">`);
    expect(existsSync(path.join(out, "favicon.svg"))).toBe(true);
    expect(index).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
  });

  test("index.html holds no inline script, style or event handler", () => {
    const index = readFileSync(path.join(out, "index.html"), "utf8");
    expect(index.match(/<script/g)).toHaveLength(1);
    expect(index).not.toMatch(/<style|style=| on[a-z]+=|javascript:|data:/i);
  });

  test("the bundle is minified, in production mode, and holds zod's jitless setting", () => {
    const script = readdirSync(path.join(out, "assets")).find((file) => file.endsWith(".js"))!;
    const bundle = readFileSync(path.join(out, "assets", script), "utf8");
    // Minified: long lines throughout. The few short ones are template literals of zod's code generator, which jitless
    // never runs, and the licence comments at the end.
    const lines = bundle.split("\n");
    expect(bundle.length / lines.length).toBeGreaterThan(2000);
    expect(bundle).not.toMatch(/process\.env\.NODE_ENV/);
    expect(bundle).toMatch(/jitless:!0/);
  });
});
```

### Create `apps/admin/test/dev-server.test.ts`

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDevServer, parsePort } from "../dev-server.mjs";
import { CONSOLE_CSP, consoleSiteHeaders } from "../site-headers.mjs";

/**
 * The development server (3a design, section 13, Task 6): it serves the build with the console site's headers, the CSP
 * of section 3 included, and forwards /api/staff/* to the API with the Host header kept, so the staff gate sees the
 * console's host. Here it serves a small dist of its own and forwards to a stand-in API on another port.
 */
let dist = "";
let api: Server;
let dev: Server;
let base = "";
const seen: { method: string; url: string; host: string | undefined; origin: string | undefined; body: string }[] = [];

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));

const bodyOf = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => resolve(text));
  });

beforeAll(async () => {
  dist = mkdtempSync(path.join(tmpdir(), "korbat-admin-dev-"));
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>console</title>");
  writeFileSync(path.join(dist, "assets", "main-ABCDEFGH.js"), "console.log(1)");
  writeFileSync(path.join(dist, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  writeFileSync(path.join(path.dirname(dist), "korbat-admin-dev-secret.txt"), "outside dist");
  api = createServer(async (req, res) => {
    seen.push({ method: req.method!, url: req.url!, host: req.headers.host, origin: req.headers.origin, body: await bodyOf(req) });
    res.writeHead(201, { "content-type": "application/json", "set-cookie": "__Host-korbat_staff=x; Path=/; Secure; HttpOnly", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true }));
  });
  const apiPort = await listen(api);
  dev = createDevServer({ dist, api: `http://127.0.0.1:${apiPort}` });
  base = `http://127.0.0.1:${await listen(dev)}`;
});

afterAll(async () => {
  await Promise.all([new Promise((r) => dev.close(r)), new Promise((r) => api.close(r))]);
  rmSync(dist, { recursive: true, force: true });
  rmSync(path.join(path.dirname(dist), "korbat-admin-dev-secret.txt"), { force: true });
});

describe("the console site's headers", () => {
  test("the CSP of section 3, exactly", () => {
    expect(CONSOLE_CSP).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; require-trusted-types-for 'script'; trusted-types 'none'",
    );
  });

  test("the page is never stored or transformed; the hashed files are kept for a year", () => {
    expect(consoleSiteHeaders("/")["Cache-Control"]).toBe("no-store, no-transform");
    expect(consoleSiteHeaders("/favicon.svg")["Cache-Control"]).toBe("no-store, no-transform");
    expect(consoleSiteHeaders("/assets/main-ABCDEFGH.js")["Cache-Control"]).toBe("public, max-age=31536000, immutable");
  });

  test("the rest of section 8's list", () => {
    expect(consoleSiteHeaders("/")).toMatchObject({
      "Content-Security-Policy": CONSOLE_CSP,
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
    });
  });
});

describe("the development server", () => {
  test("serves the page with the console site's headers, and index.html for every path of the router", async () => {
    for (const p of ["/", "/audit", "/signin", "/enroll/abc", "/no/such/page"]) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("content-security-policy"), p).toBe(CONSOLE_CSP);
      expect(res.headers.get("cache-control"), p).toBe("no-store, no-transform");
      expect(res.headers.get("content-type"), p).toBe("text/html; charset=utf-8");
      expect(await res.text()).toBe("<!doctype html><title>console</title>");
    }
  });

  test("serves a hashed file as itself, cached for a year", async () => {
    const res = await fetch(`${base}/assets/main-ABCDEFGH.js`);
    expect(await res.text()).toBe("console.log(1)");
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-security-policy")).toBe(CONSOLE_CSP);
  });

  test("never serves a file outside dist", async () => {
    // Sent as written: fetch would resolve the dot segments before the server saw them. Windows also reads a backslash
    // as a separator, so one is built from its code.
    const BACKSLASH = String.fromCharCode(92);
    const raw = (p: string): Promise<string> =>
      new Promise((resolve, reject) => {
        const url = new URL(base);
        const req = request({ host: url.hostname, port: url.port, path: p }, (res) => {
          let text = "";
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => resolve(`${res.statusCode} ${text}`));
        });
        req.on("error", reject);
        req.end();
      });
    for (const p of ["/../korbat-admin-dev-secret.txt", "/%2e%2e/korbat-admin-dev-secret.txt", "/assets/..%2f..%2fkorbat-admin-dev-secret.txt", `/assets/..${BACKSLASH}..${BACKSLASH}korbat-admin-dev-secret.txt`]) {
      expect(await raw(p), p).not.toContain("outside dist");
    }
  });

  test("forwards /api/staff/* to the API with its method, path, query, body and Host, and hands back its answer", async () => {
    seen.length = 0;
    const host = new URL(base).host;
    const res = await fetch(`${base}/api/staff/audit?cursor=5`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: '{"a":1}' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toContain("__Host-korbat_staff=x");
    expect(seen).toEqual([{ method: "POST", url: "/api/staff/audit?cursor=5", host, origin: base, body: '{"a":1}' }]);
    await fetch(`${base}/api/staff`);
    expect(seen[1]!.url).toBe("/api/staff");
  });

  test("any other /api path is not the console's: 404, and nothing reaches the API", async () => {
    seen.length = 0;
    for (const p of ["/api/me", "/api/auth/signin", "/api/staffx", "/api"]) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(404);
    }
    expect(seen).toEqual([]);
  });

  test("an API that is not running is a 502 with an error envelope", async () => {
    const lonely = createDevServer({ dist, api: "http://127.0.0.1:9" });
    const url = `http://127.0.0.1:${await listen(lonely)}`;
    const res = await fetch(`${url}/api/staff/me`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: "internal" } });
    await new Promise((r) => lonely.close(r));
  });
});

describe("the --port argument", () => {
  test("8090 by default, another port when given", () => {
    expect(parsePort([])).toBe(8090);
    expect(parsePort(["--port", "8091"])).toBe(8091);
    expect(parsePort(["--port=8092"])).toBe(8092);
    expect(parsePort(["--", "--port", "8093"])).toBe(8093);
  });

  test("anything but a port is refused", () => {
    for (const args of [["--port"], ["--port", "x"], ["--port", "0"], ["--port", "65536"], ["--bogus"]]) expect(() => parsePort(args), args.join(" ")).toThrow();
  });
});
```

### Create `apps/admin/test/enroll.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import { enrollKey, type SignalApi } from "../src/enroll";
import { enrollOptions, envelope, fakeCredentials, fakeFetch } from "./fixtures";

/**
 * Enrolment (3a design, section 9): options for the key's name and kind, the browser's registration, then the verify.
 * After a refusal for a synced key or one without user verification, and only when the console's relying party ID is not
 * the app's (rpShared false), the page asks the password manager to drop the credential it just made, through the Signal
 * API where the browser has it.
 */
const TOKEN = "A".repeat(20) + "b_-".repeat(7) + "zz";
const KEY = { id: "5b0e4a52-3c1d-4f6e-9a8b-7c6d5e4f3a2b", name: "Blue key", createdAt: "2026-10-01T09:00:00.000Z", lastUsedAt: null };

function run(rpShared: boolean, verify: { status: number; body?: unknown }, signal: SignalApi | undefined) {
  const fake = fakeFetch({
    "POST /api/staff/enroll/options": { status: 200, body: enrollOptions(rpShared) },
    "POST /api/staff/enroll/verify": verify,
  });
  const credentials = fakeCredentials();
  const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
  return { result: enrollKey({ api, credentials, signal }, { token: TOKEN, name: "Blue key", kind: "security_key" }), requests: fake.requests, credentials };
}

/** A Signal API that records its calls. */
function recordingSignal() {
  const calls: unknown[] = [];
  const signal: SignalApi = {
    signalUnknownCredential: async (options) => {
      calls.push(options);
    },
  };
  return { signal, calls };
}

describe("enrolling a staff key", () => {
  test("options for the name and kind, the browser's registration, then the verify with the same token and name", async () => {
    const { signal, calls } = recordingSignal();
    const r = run(false, { status: 200, body: { key: KEY } }, signal);
    expect(await r.result).toEqual({ ok: true, key: KEY });
    expect(r.requests.map((q) => `${q.method} ${q.url} ${q.headers["x-staff-activity"]}`)).toEqual(["POST /api/staff/enroll/options 1", "POST /api/staff/enroll/verify 1"]);
    expect(r.requests[0]!.body).toEqual({ token: TOKEN, name: "Blue key", kind: "security_key" });
    expect(r.requests[1]!.body).toMatchObject({ token: TOKEN, name: "Blue key", response: { id: "bmV3LWtleQ", type: "public-key" } });
    expect(r.credentials.calls.map((c) => c.kind)).toEqual(["create"]);
    expect(calls).toEqual([]);
  });

  for (const code of ["staff_key_not_device_bound", "staff_key_not_user_verified"]) {
    test(`${code}: the Signal API drops the new credential when the relying party is the console's own`, async () => {
      const { signal, calls } = recordingSignal();
      const r = run(false, { status: 403, body: envelope(code) }, signal);
      expect(await r.result).toEqual({ ok: false, code, status: 403, cleanup: "signalled" });
      expect(calls).toEqual([{ rpId: "localhost", credentialId: "bmV3LWtleQ" }]);
    });

    test(`${code}: never while the relying party is shared with the app, where it could drop the app's passkeys`, async () => {
      const { signal, calls } = recordingSignal();
      const r = run(true, { status: 403, body: envelope(code) }, signal);
      expect(await r.result).toEqual({ ok: false, code, status: 403, cleanup: "by-hand" });
      expect(calls).toEqual([]);
    });

    test(`${code}: a browser without the call is told to delete the entry by hand`, async () => {
      expect(await run(false, { status: 403, body: envelope(code) }, undefined).result).toMatchObject({ cleanup: "by-hand" });
      expect(await run(false, { status: 403, body: envelope(code) }, {}).result).toMatchObject({ cleanup: "by-hand" });
      const failing: SignalApi = { signalUnknownCredential: async () => Promise.reject(new Error("no")) };
      expect(await run(false, { status: 403, body: envelope(code) }, failing).result).toMatchObject({ cleanup: "by-hand" });
    });
  }

  test("any other refusal leaves the password manager alone", async () => {
    for (const code of ["staff_key_refused", "staff_enrollment_invalid", "staff_key_limit", "challenge_expired"]) {
      const { signal, calls } = recordingSignal();
      const result = await run(false, { status: 400, body: envelope(code) }, signal).result;
      expect(result, code).toEqual({ ok: false, code, status: 400, cleanup: "none" });
      expect(calls).toEqual([]);
    }
  });

  test("a refused options request asks the browser nothing", async () => {
    const fake = fakeFetch({ "POST /api/staff/enroll/options": { status: 400, body: envelope("staff_enrollment_invalid") } });
    const credentials = fakeCredentials();
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    expect(await enrollKey({ api, credentials, signal: undefined }, { token: TOKEN, name: "Blue key", kind: "this_device" })).toEqual({
      ok: false,
      code: "staff_enrollment_invalid",
      status: 400,
      cleanup: "none",
    });
    expect(credentials.calls).toEqual([]);
  });

  test("a console that is off answers the options 404", async () => {
    const fake = fakeFetch({});
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    expect(await enrollKey({ api, credentials: fakeCredentials(), signal: undefined }, { token: TOKEN, name: "Blue key", kind: "this_device" })).toMatchObject({ ok: false, code: "not_found", status: 404 });
  });

  test("a prompt the person closed sends nothing to the API", async () => {
    const fake = fakeFetch({ "POST /api/staff/enroll/options": { status: 200, body: enrollOptions(false) } });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    const closed = fakeCredentials({ create: async () => Promise.reject(Object.assign(new Error("closed"), { name: "NotAllowedError" })) });
    const result = await enrollKey({ api, credentials: closed, signal: undefined }, { token: TOKEN, name: "Blue key", kind: "this_device" });
    expect(result).toEqual({ ok: false, code: "ceremony_cancelled", status: 0, cleanup: "none" });
    expect(fake.requests.map((q) => q.url)).toEqual(["/api/staff/enroll/options"]);
  });
});
```

### Create `apps/admin/test/fixtures.ts`

```ts
import { STAFF_STEP_UP_CHALLENGE, stepUpActionHash, stepUpBinding, type StaffMe, type StaffStepUpOptionsRequest } from "@korbat/contracts";
import type { Clock } from "../src/idle";

/**
 * What the console's tests share: hostile strings of the kind a staff member's handle, key name or browser label could
 * carry if the API were ever made to echo them, a session as /me describes it, a clock the tests move by hand, a fake
 * fetch that records every request, and step-up challenges built from the contracts' layout.
 */

// Built from char codes: a right-to-left override, which would reorder the text after it if it were not isolated.
const RLO = String.fromCharCode(0x202e);

export const HOSTILE = {
  script: "<script>alert(1)</script>",
  img: "<img src=x onerror=alert(2)>",
  url: "javascript:alert(3)",
  quote: '"><svg onload=alert(4)>',
  bidi: `${RLO}gnp.exe`,
  long: "W".repeat(50),
} as const;

/** The same strings as React writes them into HTML text: escaped, never markup. */
export const HOSTILE_ESCAPED = {
  script: "&lt;script&gt;alert(1)&lt;/script&gt;",
  img: "&lt;img src=x onerror=alert(2)&gt;",
  quote: "&quot;&gt;&lt;svg onload=alert(4)&gt;",
} as const;

/** The only addresses the console ever links to; none is built from data. */
export const CONSOLE_PATHS = ["/", "/audit", "/signin"];

/** Every href attribute in rendered HTML. */
export function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
}

/** Every tag name in rendered HTML, lower-cased. */
export function tags(html: string): Set<string> {
  return new Set([...html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1]!.toLowerCase()));
}

export const SESSION_HANDLE = "2b7c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
export const OTHER_SESSION = "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36";

/** A session as GET /api/staff/me answers it, `idle` and `absolute` seconds from its end, counted from `at`. */
export function makeMe(options: { idle?: number; absolute?: number; at?: number; handle?: string; sessionHandle?: string } = {}): StaffMe {
  const at = options.at ?? Date.parse("2026-10-01T09:00:00.000Z");
  const idle = options.idle ?? 900;
  const absolute = options.absolute ?? 43_200;
  return {
    handle: options.handle ?? "mod_anna",
    role: "moderator",
    sessionHandle: options.sessionHandle ?? SESSION_HANDLE,
    idleExpiresAt: new Date(at + idle * 1000).toISOString(),
    idleSecondsLeft: idle,
    absoluteExpiresAt: new Date(at + absolute * 1000).toISOString(),
    absoluteSecondsLeft: absolute,
  };
}

/** A clock the test moves: timers fire in order of their time, and the promises they start settle before the next one. */
export class FakeClock implements Clock {
  private t = 0;
  private seq = 0;
  private timers: { at: number; id: number; callback: () => void }[] = [];

  now(): number {
    return this.t;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.push({ at: this.t + Math.max(0, ms), id, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  }

  /** How many timers are waiting. */
  get pending(): number {
    return this.timers.length;
  }

  /** Moves the clock by `ms`, firing every timer due on the way and letting what each one started settle. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.t = due.at;
      due.callback();
      await settle();
    }
    this.t = end;
    await settle();
  }
}

/** Lets every pending promise, a fetch's body included, settle. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

export interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Answer = { status: number; body?: unknown } | (() => { status: number; body?: unknown });

/**
 * A fetch that answers from a table of `METHOD path` keys (the path with its query) and records every request. A key
 * may hold a list of answers, given one per request, the last one repeated.
 */
export function fakeFetch(table: Record<string, Answer | Answer[]>) {
  const requests: Recorded[] = [];
  const used = new Map<string, number>();
  const fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    requests.push({ method, url: input, headers, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const key = `${method} ${input}`;
    const entry = table[key];
    if (entry === undefined) return new Response(JSON.stringify({ error: { code: "not_found", message: "Not found" } }), { status: 404, headers: { "content-type": "application/json" } });
    const list = Array.isArray(entry) ? entry : [entry];
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    const pick = list[Math.min(index, list.length - 1)]!;
    const answer = typeof pick === "function" ? pick() : pick;
    if (answer.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status, headers: { "content-type": "application/json" } });
  };
  return { fetch, requests };
}

/** An error envelope as the API writes it. */
export const envelope = (code: string, message = "the server's own words") => ({ error: { code, message, requestId: "req-1" } });

/** The step-up action that revokes `target`, as the console sends it. */
export const revokeAction = (target: string): StaffStepUpOptionsRequest => ({ action: "staff_session_revoked", target: { type: "staff_session", id: target }, params: {} });

/**
 * A step-up challenge in the contracts' layout: its version and purpose bytes, an expiry, a nonce, the binding of
 * `sessionHandle` and the action's hash, and a seal the console cannot check. `bytes` cuts or pads it to another length.
 */
export async function stepUpChallenge(
  sessionHandle: string,
  action: { action: string; target: { type: string; id: string }; params: Record<string, unknown> },
  options: { purpose?: number; version?: number; bytes?: number } = {},
): Promise<string> {
  const c = STAFF_STEP_UP_CHALLENGE;
  const bytes = Buffer.alloc(c.bytes, 7);
  bytes[c.versionAt] = options.version ?? c.version;
  bytes[c.purposeAt] = options.purpose ?? c.purpose;
  bytes.writeBigUInt64BE(BigInt(Date.parse("2026-10-01T09:10:00.000Z")), c.expiryAt);
  Buffer.from(await stepUpBinding(sessionHandle, await stepUpActionHash(action))).copy(bytes, c.bindingAt);
  const sized = options.bytes === undefined ? bytes : Buffer.concat([bytes, Buffer.alloc(Math.max(0, options.bytes - c.bytes), 1)]).subarray(0, options.bytes);
  return sized.toString("base64url");
}

/** Step-up options as the API writes them: the challenge, the console's relying party, user verification and an allow list. */
export function stepUpOptions(challenge: string, allow: string[] = ["Y3JlZGVudGlhbC0x"]) {
  return {
    options: {
      challenge,
      rpId: "localhost",
      timeout: 300_000,
      userVerification: "required",
      allowCredentials: allow.map((id) => ({ id, type: "public-key", transports: ["usb"] })),
    },
  };
}

const bytesOf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

/** What navigator.credentials.get resolves with, as far as the console reads it. */
export function fakeAssertion(id = "Y3JlZGVudGlhbC0x") {
  return {
    id,
    rawId: Uint8Array.from(Buffer.from(id, "base64url")).buffer,
    type: "public-key",
    authenticatorAttachment: "cross-platform",
    response: {
      clientDataJSON: bytesOf('{"type":"webauthn.get"}'),
      authenticatorData: bytesOf("authenticator-data"),
      signature: bytesOf("signature"),
      userHandle: bytesOf("user-handle"),
    },
    getClientExtensionResults: () => ({}),
  };
}

/** What navigator.credentials.create resolves with, as far as the console reads it. */
export function fakeAttestation(id = "bmV3LWtleQ") {
  return {
    id,
    rawId: Uint8Array.from(Buffer.from(id, "base64url")).buffer,
    type: "public-key",
    authenticatorAttachment: null,
    response: {
      clientDataJSON: bytesOf('{"type":"webauthn.create"}'),
      attestationObject: bytesOf("attestation-object"),
      getTransports: () => ["usb", "nfc"],
    },
    getClientExtensionResults: () => ({ credProps: { rk: true } }),
  };
}

/** A credentials container that records what it was asked and answers with `answer`. */
export function fakeCredentials(answer: { create?: () => Promise<unknown>; get?: () => Promise<unknown> } = {}) {
  const calls: { kind: "create" | "get"; options: unknown }[] = [];
  return {
    calls,
    create: async (options: unknown) => {
      calls.push({ kind: "create", options });
      return (answer.create ?? (async () => fakeAttestation()))();
    },
    get: async (options: unknown) => {
      calls.push({ kind: "get", options });
      return (answer.get ?? (async () => fakeAssertion()))();
    },
  };
}

/** Registration options as the API writes them for an enrolment. */
export function enrollOptions(rpShared: boolean) {
  return {
    options: {
      challenge: Buffer.alloc(58, 3).toString("base64url"),
      rp: { id: "localhost", name: "korbat" },
      user: { id: Buffer.alloc(32, 9).toString("base64url"), name: "Blue key", displayName: "Blue key" },
      pubKeyCredParams: [
        { alg: -8, type: "public-key" },
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" },
      ],
      timeout: 300_000,
      attestation: "none",
      excludeCredentials: [{ id: "b2xkLWtleQ", type: "public-key", transports: ["usb"] }],
      authenticatorSelection: { residentKey: "required", userVerification: "required", requireResidentKey: true },
      extensions: { credProps: true },
      hints: ["security-key"],
    },
    rpShared,
  };
}
```

### Create `apps/admin/test/idle.test.ts`

```ts
import type { StaffMe } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { ApiError } from "../src/api";
import { createIdleTimer, IDLE_MS, WARNING_MS, type IdleWarning } from "../src/idle";
import { FakeClock, makeMe } from "./fixtures";

/**
 * The idle timer (3a design, section 9), on a clock the test moves. The console counts nothing itself: it restarts at 15
 * minutes (or the time left to the absolute end) after each request its person's action started, reads /me without the
 * activity mark two minutes before the end, and then either follows what the server says (another tab may have acted)
 * or warns.
 */
const MIN = 60_000;

/** A timer whose reads of /me answer from `answers`, one per read, and fail like a 401 once they run out. */
function timer(answers: (StaffMe | ApiError)[]) {
  const clock = new FakeClock();
  const reads: number[] = [];
  const warnings: (IdleWarning | null)[] = [];
  const seen: StaffMe[] = [];
  const idle = createIdleTimer({
    clock,
    readMe: async () => {
      reads.push(clock.now());
      const next = answers.shift() ?? new ApiError(401, "staff_session_required", "ended");
      if (next instanceof ApiError) throw next;
      return next;
    },
    onWarning: (warning) => warnings.push(warning),
    onMe: (me) => seen.push(me),
  });
  const lastWarning = () => (warnings.length === 0 ? null : warnings[warnings.length - 1]!);
  return { clock, idle, reads, warnings, seen, lastWarning };
}

describe("the idle timer", () => {
  test("the limits: 15 minutes, and a warning two minutes before the end", () => {
    expect(IDLE_MS).toBe(15 * MIN);
    expect(WARNING_MS).toBe(2 * MIN);
  });

  test("reads /me at 13 minutes of a full idle period, not before", async () => {
    const t = timer([makeMe({ idle: 120 })]);
    t.idle.start(makeMe({ idle: 900 }));
    await t.clock.advance(13 * MIN - 1);
    expect(t.reads).toEqual([]);
    await t.clock.advance(1);
    expect(t.reads).toEqual([13 * MIN]);
  });

  test("restarts at 15 minutes when a marked request succeeds", async () => {
    const t = timer([makeMe({ idle: 120 })]);
    t.idle.start(makeMe({ idle: 900 }));
    await t.clock.advance(10 * MIN);
    t.idle.restart();
    await t.clock.advance(12 * MIN);
    expect(t.reads).toEqual([]);
    await t.clock.advance(1 * MIN);
    expect(t.reads).toEqual([23 * MIN]);
  });

  test("another tab's activity moves the end: more than two minutes left sets the timer from the answer, with no warning", async () => {
    const t = timer([makeMe({ idle: 600 }), makeMe({ idle: 120 })]);
    t.idle.start(makeMe({ idle: 900 }));
    await t.clock.advance(13 * MIN);
    expect(t.reads).toEqual([13 * MIN]);
    expect(t.lastWarning()).toBeNull();
    expect(t.seen).toHaveLength(1);
    // 600 seconds left at 13 minutes: the next read is two minutes before that end, at 21 minutes.
    await t.clock.advance(8 * MIN - 1);
    expect(t.reads).toHaveLength(1);
    await t.clock.advance(1);
    expect(t.reads).toEqual([13 * MIN, 21 * MIN]);
    expect(t.lastWarning()).toEqual({ kind: "idle" });
  });

  test("two minutes or less: the warning with Stay signed in, which a marked success clears", async () => {
    const t = timer([makeMe({ idle: 120 })]);
    t.idle.start(makeMe({ idle: 900 }));
    await t.clock.advance(13 * MIN);
    expect(t.lastWarning()).toEqual({ kind: "idle" });
    // "Stay signed in" sends one marked GET /me; its success restarts the timer.
    await t.clock.advance(30_000);
    t.idle.restart();
    expect(t.lastWarning()).toBeNull();
    await t.clock.advance(13 * MIN - 1);
    expect(t.reads).toHaveLength(1);
    await t.clock.advance(1);
    expect(t.reads).toHaveLength(2);
  });

  test("when the timer runs out it reads /me once more and follows the answer", async () => {
    const t = timer([makeMe({ idle: 120 }), makeMe({ idle: 840 })]);
    t.idle.start(makeMe({ idle: 900 }));
    await t.clock.advance(13 * MIN);
    expect(t.lastWarning()).toEqual({ kind: "idle" });
    await t.clock.advance(2 * MIN);
    expect(t.reads).toEqual([13 * MIN, 15 * MIN]);
    // Another tab acted meanwhile: 14 minutes left, so the warning goes and the next read is at 15 + 12 minutes.
    expect(t.lastWarning()).toBeNull();
    await t.clock.advance(12 * MIN);
    expect(t.reads).toEqual([13 * MIN, 15 * MIN, 27 * MIN]);
  });

  test("when the timer runs out on a session that ended, it stops: the 401 has already shown sign-in", async () => {
    const t = timer([makeMe({ idle: 120 })]);
    t.idle.start(makeMe({ idle: 900 }));
    await t.clock.advance(15 * MIN);
    expect(t.reads).toEqual([13 * MIN, 15 * MIN]);
    expect(t.clock.pending).toBe(0);
    await t.clock.advance(60 * MIN);
    expect(t.reads).toHaveLength(2);
  });

  test("the absolute end, when nearer, sets the timer, and its warning names the time and offers no button", async () => {
    const me = makeMe({ idle: 900, absolute: 600 });
    const t = timer([makeMe({ idle: 120, absolute: 120 })]);
    t.idle.start({ ...me, idleSecondsLeft: 600, idleExpiresAt: me.absoluteExpiresAt });
    await t.clock.advance(8 * MIN - 1);
    expect(t.reads).toEqual([]);
    await t.clock.advance(1);
    expect(t.reads).toEqual([8 * MIN]);
    const warning = t.lastWarning();
    expect(warning).toEqual({ kind: "absolute", endsAt: makeMe({ idle: 120, absolute: 120 }).absoluteExpiresAt });
    // A marked success restarts the timer, but nothing moves the absolute end: the warning stays.
    t.idle.restart();
    expect(t.lastWarning()).toEqual(warning);
  });

  test("a marked success never sets the timer past the absolute end", async () => {
    const t = timer([makeMe({ idle: 120, absolute: 120 })]);
    t.idle.start(makeMe({ idle: 900, absolute: 1200 }));
    await t.clock.advance(10 * MIN);
    // 10 minutes left to the absolute end: the timer restarts at 10, not 15, so it reads at 18 minutes.
    t.idle.restart();
    await t.clock.advance(8 * MIN - 1);
    expect(t.reads).toEqual([]);
    await t.clock.advance(1);
    expect(t.reads).toEqual([18 * MIN]);
    expect(t.lastWarning()).toMatchObject({ kind: "absolute" });
  });

  test("a session that starts with two minutes or less left warns at once", async () => {
    const t = timer([]);
    t.idle.start(makeMe({ idle: 90 }));
    expect(t.lastWarning()).toEqual({ kind: "idle" });
  });

  test("a read that fails for another reason keeps the timer going on what it knew", async () => {
    const t = timer([new ApiError(0, "network", "down"), makeMe({ idle: 840 })]);
    t.idle.start(makeMe({ idle: 900 }));
    await t.clock.advance(13 * MIN);
    expect(t.lastWarning()).toEqual({ kind: "idle" });
    await t.clock.advance(2 * MIN);
    expect(t.reads).toEqual([13 * MIN, 15 * MIN]);
    expect(t.lastWarning()).toBeNull();
  });

  test("stopped, it reads nothing and a restart does not start it again", async () => {
    const t = timer([makeMe({ idle: 120 })]);
    t.idle.start(makeMe({ idle: 900 }));
    t.idle.stop();
    t.idle.restart();
    await t.clock.advance(60 * MIN);
    expect(t.reads).toEqual([]);
    expect(t.clock.pending).toBe(0);
  });

  test("an answer that arrives after a restart is not allowed to undo it", async () => {
    let release: (me: StaffMe) => void = () => undefined;
    const clock = new FakeClock();
    const warnings: (IdleWarning | null)[] = [];
    const reads: number[] = [];
    const idle = createIdleTimer({
      clock,
      readMe: () => {
        reads.push(clock.now());
        return new Promise<StaffMe>((resolve) => {
          release = resolve;
        });
      },
      onWarning: (w) => warnings.push(w),
      onMe: () => undefined,
    });
    idle.start(makeMe({ idle: 900 }));
    await clock.advance(13 * MIN);
    idle.restart();
    release(makeMe({ idle: 60 }));
    await clock.advance(1);
    expect(warnings.filter((w) => w !== null)).toEqual([]);
    await clock.advance(13 * MIN);
    expect(reads).toEqual([13 * MIN, 26 * MIN]);
  });
});
```

### Create `apps/admin/test/router.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { parseRoute } from "../src/router";

/** The console's own router (3a design, section 9): four paths and nothing else. */
describe("the router", () => {
  test("the four paths", () => {
    expect(parseRoute("/")).toEqual({ name: "home" });
    expect(parseRoute("/audit")).toEqual({ name: "audit" });
    expect(parseRoute("/signin")).toEqual({ name: "signin" });
    const token = "A".repeat(20) + "b_-".repeat(7) + "zz";
    expect(parseRoute(`/enroll/${token}`)).toEqual({ name: "enroll", token });
  });

  test("a trailing slash names the same page", () => {
    expect(parseRoute("/audit/")).toEqual({ name: "audit" });
    expect(parseRoute("/signin/")).toEqual({ name: "signin" });
    expect(parseRoute("/enroll/abc/")).toEqual({ name: "enroll", token: "abc" });
  });

  test("an enrolment path keeps its token exactly as written, for the page to check", () => {
    expect(parseRoute("/enroll/%3Cscript%3E")).toEqual({ name: "enroll", token: "%3Cscript%3E" });
  });

  test("anything else is no page of the console", () => {
    for (const path of ["", "/home", "/Audit", "/audit/x", "/enroll", "/enroll/", "/enroll/a/b", "/api/staff/me", "//audit", "/signin/x"]) {
      expect(parseRoute(path), path).toEqual({ name: "unknown" });
    }
  });
});
```

### Create `apps/admin/test/screens.test.tsx`

```tsx
import type { AuditEntry, StaffKey, StaffMe, StaffSession } from "@korbat/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { App } from "../src/App";
import { createStaffApi } from "../src/api";
import { IdleNotice, Layout } from "../src/Layout";
import { AuditView } from "../src/screens/Audit";
import { EnrollView } from "../src/screens/Enroll";
import { HomeView, openHome } from "../src/screens/Home";
import { SignInView } from "../src/screens/SignIn";
import { Unavailable, UNAVAILABLE_TEXT } from "../src/screens/Unavailable";
import { serverNow } from "../src/signins";
import { createConsoleStore } from "../src/store";
import type { Loadable } from "../src/ui";
import { CONSOLE_PATHS, envelope, FakeClock, fakeCredentials, fakeFetch, HOSTILE, HOSTILE_ESCAPED, hrefs, makeMe, OTHER_SESSION, SESSION_HANDLE, settle, tags } from "./fixtures";

/**
 * Each screen server-rendered, as the app's tests render theirs (3a design, section 12, Console). Every string a person
 * wrote (handles, key names, browser labels) arrives here hostile: markup, a javascript: URL, a direction override and
 * the longest name allowed. It must come out as escaped text in an isolating <bdi>, never as markup or a link.
 */
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const noop = () => undefined;

/** Every hostile string's text shows, escaped; no element or link came from any of them. */
function expectInert(out: string) {
  expect(out).toContain(HOSTILE_ESCAPED.script);
  expect(out).toContain(HOSTILE_ESCAPED.img);
  expect(out).not.toMatch(/<(script|img|svg|iframe|style|object|embed)\b/i);
  expect(out).not.toMatch(/href="javascript:/i);
  for (const href of hrefs(out)) expect(CONSOLE_PATHS, href).toContain(href);
  // The direction override stays inside an isolating element, so it cannot reorder the text around it.
  expect(out).toContain(`<bdi>${HOSTILE.bidi}</bdi>`);
}

const ME: StaffMe = { ...makeMe({ at: Date.parse("2026-10-01T09:40:00.000Z"), absolute: 12 * 3600, handle: HOSTILE.script }) };

const signIn = (handle: string, seq: number): AuditEntry => ({
  seq,
  hash: "b".repeat(64),
  createdAt: "2026-09-30T08:05:00.000Z",
  actorHandle: handle,
  action: "staff_sign_in",
  targetType: "staff_session",
  targetId: SESSION_HANDLE,
  actionHash: null,
});

const SESSIONS: StaffSession[] = [
  { handle: SESSION_HANDLE, browser: HOSTILE.img, createdAt: "2026-10-01T09:40:00.000Z", lastUsedAt: "2026-10-01T09:41:00.000Z", current: true },
  { handle: OTHER_SESSION, browser: HOSTILE.bidi, createdAt: "2026-10-01T07:00:00.000Z", lastUsedAt: "2026-10-01T07:30:00.000Z", current: false },
];

const KEYS: StaffKey[] = [
  { id: "5b0e4a52-3c1d-4f6e-9a8b-7c6d5e4f3a2b", name: HOSTILE.long, createdAt: "2026-09-01T10:00:00.000Z", lastUsedAt: null },
  { id: "6c1f5b63-4d2e-4a7f-8b9c-8d7e6f5a4b3c", name: HOSTILE.url, createdAt: "2026-09-02T10:00:00.000Z", lastUsedAt: "2026-10-01T09:40:00.000Z" },
];

describe("sign-in", () => {
  test("asks for the staff key", () => {
    const out = html(<SignInView ended={false} busy={false} error={null} onSignIn={noop} />);
    expect(out).toContain("Sign in with your staff key");
    expect(out).not.toContain("Your staff session ended");
    expect(out).toContain("<button");
  });

  test("after a session ended, says so", () => {
    expect(html(<SignInView ended busy={false} error={null} onSignIn={noop} />)).toContain("Your staff session ended.");
  });

  test("a failed sign-in shows the console's words and says to choose the security key or Windows Hello", () => {
    const out = html(<SignInView ended={false} busy={false} error="This key does not open the staff console." onSignIn={noop} />);
    expect(out).toContain('role="alert"');
    expect(out).toContain("This key does not open the staff console.");
    expect(out).toMatch(/security key or Windows Hello/);
    expect(out).toMatch(/password manager/);
  });

  test("a busy button says so and cannot be pressed twice", () => {
    expect(html(<SignInView ended={false} busy error={null} onSignIn={noop} />)).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"|<button[^>]*aria-busy="true"[^>]*disabled=""/);
  });
});

describe("enrolment", () => {
  const base = { tokenValid: true, name: "", nameError: null, busy: null, result: null, onName: noop, onRegister: noop } as const;

  test("its guidance: which keys work, which are refused, the PIN, the name, and the two buttons", () => {
    const out = html(<EnrollView {...base} />);
    expect(out).toMatch(/security key with a PIN/);
    expect(out).toMatch(/Windows Hello on this computer/);
    expect(out).toMatch(/iCloud Keychain/);
    expect(out).toMatch(/Google Password Manager/);
    expect(out).toMatch(/phone&#x27;s own passkeys/);
    expect(out).toMatch(/set a PIN/i);
    expect(out).toMatch(/not your email address or your real name/);
    expect(out).toContain('maxLength="50"');
    expect(out).toContain(">Register a security key</button>");
    expect(out).toContain(">Use Windows Hello on this computer</button>");
    expect(out).toMatch(/choose Windows Hello or this device in the browser&#x27;s dialog/);
  });

  test("a link whose token is not one shows only that the link is no good", () => {
    const out = html(<EnrollView {...base} tokenValid={false} />);
    expect(out).toContain("This enrolment link has expired or was already used. Ask the operator for a new one.");
    expect(out).not.toContain("<button");
  });

  test("a name the rules refuse is said next to the field", () => {
    const out = html(<EnrollView {...base} name={HOSTILE.bidi} nameError="Give the key a name of 1 to 50 characters." />);
    expect(out).toContain("Give the key a name of 1 to 50 characters.");
    expect(out).toContain('aria-invalid="true"');
  });

  test("each refusal is explained in words, says the link still works, and how the refused passkey goes", () => {
    const synced = html(<EnrollView {...base} result={{ ok: false, code: "staff_key_not_device_bound", status: 403, cleanup: "signalled" }} />);
    expect(synced).toMatch(/saved a synced passkey/);
    expect(synced).toMatch(/link still works/);
    expect(synced).toMatch(/asked to remove/);
    const noPin = html(<EnrollView {...base} result={{ ok: false, code: "staff_key_not_user_verified", status: 403, cleanup: "by-hand" }} />);
    expect(noPin).toMatch(/asked for no PIN or fingerprint/);
    expect(noPin).toMatch(/link still works/);
    expect(noPin).toMatch(/Delete .* from your password manager by hand/);
    const refused = html(<EnrollView {...base} result={{ ok: false, code: "staff_key_refused", status: 400, cleanup: "none" }} />);
    expect(refused).toMatch(/answer could not be checked/);
    expect(refused).toMatch(/link still works/);
    expect(refused).not.toMatch(/password manager by hand|asked to remove/);
    for (const out of [synced, noPin, refused]) {
      expect(out).not.toMatch(/passkey_/);
      expect(out).toContain("<button");
    }
  });

  test("a dead link or a full set of keys leaves nothing to try", () => {
    for (const code of ["staff_enrollment_invalid", "staff_key_limit"]) {
      const out = html(<EnrollView {...base} result={{ ok: false, code, status: 400, cleanup: "none" }} />);
      expect(out, code).not.toContain("<button");
    }
  });

  test("a registered key's name is text, and the page says to sign in with it once", () => {
    for (const name of [HOSTILE.script, HOSTILE.img, HOSTILE.bidi]) {
      const out = html(<EnrollView {...base} result={{ ok: true, key: { id: "5b0e4a52-3c1d-4f6e-9a8b-7c6d5e4f3a2b", name, createdAt: "2026-10-01T09:00:00.000Z", lastUsedAt: null } }} />);
      expect(out).toMatch(/Sign in with it once/);
      expect(out).toContain('href="/signin"');
      expect(out).not.toMatch(/<(script|img)\b/);
      expect(out).toContain(`<bdi>`);
    }
  });
});

describe("home", () => {
  const props = {
    me: ME,
    signIns: { state: "ready" as const, value: [signIn(HOSTILE.script, 9), signIn(HOSTILE.bidi, 8), signIn(HOSTILE.img, 7)] },
    sessions: { state: "ready" as const, value: SESSIONS },
    keys: { state: "ready" as const, value: KEYS },
    revoking: null,
    notice: null,
    error: null,
    onRevoke: noop,
  };

  test("who is signed in, the role, the session's end, sign-ins, sessions and keys, every string as text", () => {
    const out = html(<HomeView {...props} />);
    expectInert(out);
    expect(out).toContain("Signed in until 21:40");
    expect(out).toContain("moderator");
    expect(out).toContain("2026-09-30 08:05");
    expect(out).toContain(HOSTILE.long);
    expect(out).toContain("javascript:alert(3)");
    expect(out).toContain("Cases arrive in sub-project 3c.");
  });

  test("Sign out that session on the other sessions, never on this one", () => {
    const out = html(<HomeView {...props} />);
    expect(out.match(/>Sign out that session</g)).toHaveLength(1);
    expect(out).toContain("This session");
  });

  test("a revocation under way, its outcome, and a refusal in the console's words", () => {
    expect(html(<HomeView {...props} revoking={OTHER_SESSION} />)).toMatch(/aria-busy="true"/);
    expect(html(<HomeView {...props} notice="That session is signed out." />)).toContain("That session is signed out.");
    expect(html(<HomeView {...props} error="That confirmation was for another action." />)).toMatch(/role="alert"[^>]*>That confirmation was for another action\./);
  });

  test("no sign-ins, and lists still loading or failed", () => {
    const out = html(<HomeView {...props} signIns={{ state: "ready", value: [] }} sessions={{ state: "loading" }} keys={{ state: "failed", message: "Cannot reach the server." }} />);
    expect(out).toContain("No staff sign-ins in the last 7 days.");
    expect(out).toContain("Loading");
    expect(out).toContain("Cannot reach the server.");
  });

  test("opened 11 hours after the page read its session, it lists sign-ins back to 7 days before its own opening", async () => {
    // The page read its session at 09:00 and its person kept acting, so the idle timer never read /me again: the session
    // the page holds still says 09:00 when Home opens at 20:00.
    const pageOpened = Date.parse("2026-10-01T09:00:00.000Z");
    const homeOpened = Date.parse("2026-10-01T20:00:00.000Z");
    const at = (createdAt: string, seq: number): AuditEntry => ({ ...signIn("mod_anna", seq), createdAt });
    const fake = fakeFetch({
      "GET /api/staff/me": [{ status: 200, body: makeMe({ at: pageOpened }) }, { status: 200, body: makeMe({ at: homeOpened, absolute: 3600 }) }],
      "GET /api/staff/audit?action=staff_sign_in": {
        status: 200,
        body: {
          entries: [
            at("2026-10-01T19:00:00.000Z", 40),
            at("2026-09-24T20:30:00.000Z", 39),
            // Older than 7 days at 20:00, though not at the page's stale 09:00: the list ends before it.
            at("2026-09-24T19:30:00.000Z", 38),
            at("2026-09-24T09:30:00.000Z", 37),
          ],
          nextCursor: 37,
        },
      },
      "GET /api/staff/sessions": { status: 200, body: { sessions: [] } },
      "GET /api/staff/keys": { status: 200, body: { keys: [] } },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    const store = createConsoleStore({ api, clock: new FakeClock(), path: "/", history: { pushState: noop, replaceState: noop } });
    await store.start();
    const held = store.get().session;
    if (held.kind !== "signed-in") throw new Error("the page holds no session");
    expect(serverNow(held.me)).toBe(pageOpened);

    // What the screen runs when it opens, with the session the page holds as its `me`.
    let signIns: Loadable<AuditEntry[]> = { state: "loading" };
    openHome(api, { current: true }, { signIns: (value) => (signIns = value), sessions: noop, keys: noop });
    await settle();
    expect(signIns).toMatchObject({ state: "ready" });
    const out = html(<HomeView {...props} me={held.me} signIns={signIns} />);
    expect(out).toContain("2026-10-01 19:00");
    expect(out).toContain("2026-09-24 20:30");
    expect(out).not.toContain("2026-09-24 19:30");
    expect(out).not.toContain("2026-09-24 09:30");
    // The screen's own /me, marked as its person's opening of it, came before the first page of sign-ins.
    const asked = fake.requests.map((r) => `${r.url} ${r.headers["x-staff-activity"]}`);
    expect(asked.filter((r) => r.startsWith("/api/staff/me"))).toEqual(["/api/staff/me 1", "/api/staff/me 1"]);
    expect(asked.indexOf("/api/staff/audit?action=staff_sign_in 1")).toBeGreaterThan(asked.lastIndexOf("/api/staff/me 1"));
    store.dispose();
  });
});

describe("the audit log", () => {
  const entries: AuditEntry[] = [
    { seq: 120, hash: "c".repeat(64), createdAt: "2026-10-01T09:00:05.000Z", actorHandle: HOSTILE.script, action: "staff_session_revoked", targetType: "staff_session", targetId: OTHER_SESSION, actionHash: "d".repeat(64) },
    { seq: 119, hash: "e".repeat(64), createdAt: "2026-10-01T08:00:00.000Z", actorHandle: HOSTILE.bidi, action: HOSTILE.img, targetType: null, targetId: null, actionHash: null },
    { seq: 118, hash: "f".repeat(64), createdAt: "2026-10-01T07:00:00.000Z", actorHandle: null, action: "staff_key_added", targetType: "staff_key", targetId: HOSTILE.url, actionHash: null },
  ];
  const props = {
    page: { state: "ready" as const, value: entries },
    hasOlder: true,
    loadingOlder: false,
    at: null,
    place: "",
    placeError: null,
    error: null,
    onLoadOlder: noop,
    onPlace: noop,
    onGoToPlace: noop,
    onNewest: noop,
  };

  test("a table, newest first, with each row's place and full hash, every string as text", () => {
    const out = html(<AuditView {...props} />);
    expectInert(out);
    expect(out).toContain("<table");
    expect(out.indexOf(">120<")).toBeLessThan(out.indexOf(">119<"));
    expect(out).toContain("c".repeat(64));
    expect(out).toContain("d".repeat(64));
    expect(out).toContain("javascript:alert(3)");
  });

  test("Load older while there is an older page, and Go to place", () => {
    const out = html(<AuditView {...props} />);
    expect(out).toContain(">Load older</button>");
    expect(out).toContain(">Go to place</button>");
    expect(html(<AuditView {...props} hasOlder={false} />)).not.toContain(">Load older</button>");
  });

  test("a page opened at a place offers the newest again, and a place the rules refuse is said", () => {
    const out = html(<AuditView {...props} at={7} place="7" />);
    expect(out).toContain(">Newest</button>");
    expect(html(<AuditView {...props} place="abc" placeError="Enter a place: a whole number from 1." />)).toContain("Enter a place: a whole number from 1.");
  });
});

describe("the warnings of the idle timer", () => {
  test("a live region is always there, so a warning is announced when it appears", () => {
    expect(html(<IdleNotice warning={null} onStay={noop} />)).toMatch(/role="status"/);
  });

  test("the idle warning, with Stay signed in", () => {
    const out = html(<IdleNotice warning={{ kind: "idle" }} onStay={noop} />);
    expect(out).toContain("Your staff session ends in 2 minutes.");
    expect(out).toContain(">Stay signed in</button>");
  });

  test("the absolute end's warning, without a button", () => {
    const out = html(<IdleNotice warning={{ kind: "absolute", endsAt: "2026-10-01T21:40:00.000Z" }} onStay={noop} />);
    expect(out).toContain("Your staff session ends at 21:40. Sign in again with your staff key then.");
    expect(out).not.toContain("<button");
  });

  test("the layout names who is signed in as text, and links only to the console's own pages", () => {
    const out = html(
      <Layout me={ME} path="/" warning={null} onNavigate={noop} onSignOut={noop} onStay={noop}>
        <p>child</p>
      </Layout>,
    );
    expect(out).toContain(HOSTILE_ESCAPED.script);
    for (const href of hrefs(out)) expect(CONSOLE_PATHS).toContain(href);
    expect(out).toContain('aria-current="page"');
    expect(out).toContain(">Sign out</button>");
  });
});

describe("a console that is off, or opened at another address", () => {
  test("shows only the sentence", () => {
    expect(UNAVAILABLE_TEXT).toBe(
      "The staff console is not available at this address. It is off on this server, or this is not the address set in CONSOLE_ORIGIN: open it at exactly that address, never at 127.0.0.1.",
    );
    const out = html(<Unavailable />);
    expect(out).toContain(UNAVAILABLE_TEXT);
    expect(tags(out)).toEqual(new Set(["main", "p"]));
  });
});

describe("the whole page by the console's state", () => {
  async function page(path: string, table: Parameters<typeof fakeFetch>[0], cookie = "") {
    const api = createStaffApi({ fetch: fakeFetch(table).fetch, cookie: () => cookie });
    const store = createConsoleStore({ api, clock: new FakeClock(), path, history: { pushState: noop, replaceState: noop } });
    await store.start();
    return { store, render: () => html(<App store={store} credentials={fakeCredentials()} signal={undefined} />) };
  }

  test("the home and audit pages for a live session", async () => {
    const home = await page("/", { "GET /api/staff/me": { status: 200, body: ME } });
    expect(home.render()).toMatch(/<h2[^>]*>Home</);
    expect(home.render()).toContain(HOSTILE_ESCAPED.script);
    const audit = await page("/audit", { "GET /api/staff/me": { status: 200, body: ME } });
    expect(audit.render()).toMatch(/<h2[^>]*>Audit log</);
  });

  test("sign-in in place, at the same address, when the session ended", async () => {
    const p = await page("/audit", { "GET /api/staff/me": [{ status: 200, body: ME }, { status: 401, body: envelope("staff_session_required") }] });
    await p.store.api.me().catch(() => undefined);
    const out = p.render();
    expect(out).toContain("Your staff session ended.");
    expect(out).not.toMatch(/<h2[^>]*>Audit log</);
  });

  test("reopened after its session ended while no page held it, the page says the session ended, at the same address", async () => {
    // The staff CSRF cookie is set only by a sign-in and lasts the session's 12 hours; only a sign-out or this 401 clears it.
    const p = await page("/audit", { "GET /api/staff/me": { status: 401, body: envelope("staff_session_required") } }, "__Host-korbat_staff_csrf=t");
    const out = p.render();
    expect(out).toContain("Your staff session ended.");
    expect(out).toContain("Sign in with your staff key");
    expect(p.store.get().path).toBe("/audit");
  });

  test("opened with no staff session at all, plain sign-in", async () => {
    const p = await page("/audit", { "GET /api/staff/me": { status: 401, body: envelope("staff_session_required") } });
    const out = p.render();
    expect(out).toContain("Sign in with your staff key");
    expect(out).not.toContain("Your staff session ended");
  });

  test("only the sentence when the console is off", async () => {
    const p = await page("/", {});
    expect(p.render()).toBe(html(<Unavailable />));
  });

  test("the enrolment page with no session read", async () => {
    const token = "A".repeat(43);
    const p = await page(`/enroll/${token}`, {});
    expect(p.render()).toContain(">Register a security key</button>");
  });

  test("an address the console does not have", async () => {
    const p = await page("/nowhere", { "GET /api/staff/me": { status: 200, body: ME } });
    expect(p.render()).toMatch(/no page at this address/);
  });
});
```

### Create `apps/admin/test/signins.test.ts`

```ts
import type { AuditEntry, AuditPage } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import { readRecentSignIns, readSignInsAtOpening, serverNow, SIGN_IN_WINDOW_MS } from "../src/signins";
import { fakeFetch, makeMe } from "./fixtures";

/**
 * The home screen's list of every staff account's sign-ins in the last 7 days (3a design, section 9): the audit reader's
 * staff_sign_in filter, read page by page, newest first, until a sign-in older than 7 days.
 */
const NOW = Date.parse("2026-10-01T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

let seq = 1000;
function signIn(ageMs: number, handle = "mod_anna"): AuditEntry {
  seq -= 1;
  return {
    seq,
    hash: "a".repeat(64),
    createdAt: new Date(NOW - ageMs).toISOString(),
    actorHandle: handle,
    action: "staff_sign_in",
    targetType: "staff_session",
    targetId: "2b7c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
    actionHash: null,
  };
}

describe("the staff sign-ins of the last 7 days", () => {
  test("the server's now, from the session's absolute end and the seconds left to it, not the browser's clock", () => {
    expect(serverNow(makeMe({ at: NOW, absolute: 3600 }))).toBe(NOW);
    expect(SIGN_IN_WINDOW_MS).toBe(7 * DAY);
  });

  test("reads pages until it meets a sign-in older than 7 days, and keeps none older", async () => {
    const pages: AuditPage[] = [
      { entries: [signIn(1000), signIn(DAY)], nextCursor: 51 },
      { entries: [signIn(3 * DAY), signIn(7 * DAY - 1)], nextCursor: 40 },
      { entries: [signIn(7 * DAY + 1, "old_one"), signIn(8 * DAY, "older")], nextCursor: 30 },
      { entries: [signIn(9 * DAY, "never_read")], nextCursor: null },
    ];
    const asked: (number | undefined)[] = [];
    const list = await readRecentSignIns(async (cursor) => {
      asked.push(cursor);
      return pages[asked.length - 1]!;
    }, NOW - 7 * DAY);
    expect(asked).toEqual([undefined, 51, 40]);
    expect(list.map((e) => Date.parse(e.createdAt))).toEqual([NOW - 1000, NOW - DAY, NOW - 3 * DAY, NOW - 7 * DAY + 1]);
  });

  test("stops at the last page", async () => {
    const asked: (number | undefined)[] = [];
    const list = await readRecentSignIns(async (cursor) => {
      asked.push(cursor);
      return { entries: [signIn(DAY)], nextCursor: null };
    }, NOW - 7 * DAY);
    expect(asked).toEqual([undefined]);
    expect(list).toHaveLength(1);
  });

  test("a cursor that does not move back stops the reading rather than loop", async () => {
    const asked: (number | undefined)[] = [];
    await readRecentSignIns(async (cursor) => {
      asked.push(cursor);
      return { entries: [signIn(DAY)], nextCursor: 51 };
    }, NOW - 7 * DAY);
    expect(asked).toEqual([undefined, 51]);
  });

  test("only sign-ins are listed, whatever else the answer holds", async () => {
    const other = { ...signIn(DAY), action: "staff_signed_out" };
    const list = await readRecentSignIns(async () => ({ entries: [other, signIn(DAY)], nextCursor: null }), NOW - 7 * DAY);
    expect(list.map((e) => e.action)).toEqual(["staff_sign_in"]);
  });

  test("through the API: the filter on every page, each request marked as the person's opening of the screen", async () => {
    const fake = fakeFetch({
      "GET /api/staff/audit?action=staff_sign_in": { status: 200, body: { entries: [signIn(DAY)], nextCursor: 12 } },
      "GET /api/staff/audit?action=staff_sign_in&cursor=12": { status: 200, body: { entries: [signIn(8 * DAY)], nextCursor: 3 } },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    const list = await readRecentSignIns((cursor) => api.audit({ action: "staff_sign_in", cursor }, { activity: true }), NOW - 7 * DAY);
    expect(list).toHaveLength(1);
    expect(fake.requests.map((r) => `${r.url} ${r.headers["x-staff-activity"]}`)).toEqual(["/api/staff/audit?action=staff_sign_in 1", "/api/staff/audit?action=staff_sign_in&cursor=12 1"]);
  });

  test("at the screen's opening: the server's time from a marked /me read then, and the pages back to 7 days before it", async () => {
    const fake = fakeFetch({
      "GET /api/staff/me": { status: 200, body: makeMe({ at: NOW, absolute: 3600 }) },
      "GET /api/staff/audit?action=staff_sign_in": { status: 200, body: { entries: [signIn(DAY), signIn(7 * DAY - 1000), signIn(7 * DAY + 1000)], nextCursor: 40 } },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    const list = await readSignInsAtOpening(api);
    expect(list.map((e) => Date.parse(e.createdAt))).toEqual([NOW - DAY, NOW - 7 * DAY + 1000]);
    expect(fake.requests.map((r) => `${r.url} ${r.headers["x-staff-activity"]}`)).toEqual(["/api/staff/me 1", "/api/staff/audit?action=staff_sign_in 1"]);
  });
});
```

### Create `apps/admin/test/source.test.ts`

```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { describe, expect, test } from "vitest";

/**
 * What the console's source must never hold (3a design, sections 3 and 9, and console-lab.md section 8). The page runs
 * under require-trusted-types-for 'script' with trusted-types 'none', so each of these sinks would throw at run time and
 * take its screen down; this scan finds them first. Every user-written string is a text node, and no link is built from
 * data.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

/**
 * Every line of the page's source (src/, which the bundle is built from) matching `pattern`, as `file:line`. The build
 * and development scripts run in Node, never in the page, so they are not scanned: the page they write needs its one
 * script element.
 */
function findInSource(pattern: RegExp): string[] {
  const found: string[] = [];
  const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).map((file) => path.join("src", file));
  for (const file of files) {
    if (!/\.(ts|tsx|css)$/.test(file)) continue;
    const lines = readFileSync(path.join(ROOT, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (pattern.test(line)) found.push(`${file.split(path.sep).join("/")}:${index + 1}`);
    });
  }
  return found.sort();
}

describe("no HTML or script sink in apps/admin", () => {
  const sinks: [string, RegExp][] = [
    ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
    ["innerHTML and outerHTML", /\b(inner|outer)HTML\b/],
    ["insertAdjacentHTML", /insertAdjacentHTML/],
    ["createContextualFragment", /createContextualFragment/],
    ["document.write", /document\.write/],
    ["srcdoc", /srcdoc/i],
    ["eval", /\beval\s*\(/],
    ["new Function", /new\s+Function\b|\bFunction\s*\(/],
    ["a string as a timer's code", /setTimeout\(\s*["'`]|setInterval\(\s*["'`]/],
    ["a rendered script or style element", /<script|<style|createElement\(\s*["'`](script|style)/i],
    ["React's preinit and preload", /\bpre(init|initModule|load|loadModule)\b/],
    ["a style attribute set as text", /setAttribute\(\s*["'`]style/],
    ["setAttribute at all: React sets every attribute", /\.setAttribute\(/],
    ["a Trusted Types policy", /trustedTypes|createPolicy/],
    ["DOMParser", /DOMParser/],
    ["window.open and navigations built in code", /window\.open|location\.(href|assign|replace)\s*[=(]/],
  ];
  for (const [name, pattern] of sinks) {
    test(name, () => {
      expect(findInSource(pattern)).toEqual([]);
    });
  }

  test("no style prop: every style is in the one CSS file", () => {
    expect(findInSource(/\bstyle=\{/)).toEqual([]);
    const css = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".css"));
    expect(css).toEqual(["app.css"]);
  });

  test("no link is built from data: the only href written from a value is NavLink's, whose type lists the console's own paths", () => {
    expect(findInSource(/href=\{/).map((found) => found.split(":")[0])).toEqual(["src/nav.tsx"]);
    const nav = readFileSync(path.join(SRC, "nav.tsx"), "utf8");
    expect(nav).toMatch(/href=\{to\}/);
    expect(nav).toMatch(/to: ConsolePath/);
    expect(readFileSync(path.join(SRC, "router.ts"), "utf8")).toMatch(/export type ConsolePath = "\/" \| "\/audit" \| "\/signin";/);
  });

  test("no src or action attribute written from a value", () => {
    expect(findInSource(/\b(src|action|formAction|xlinkHref)=\{/)).toEqual([]);
  });

  test("never a passkey_* code or text: the console has its own words", () => {
    expect(findInSource(/passkey_/)).toEqual([]);
  });
});

describe("zod is jitless before the first schema is built", () => {
  test("the entry's first import is the module that sets it", () => {
    const main = readFileSync(path.join(SRC, "main.tsx"), "utf8");
    const imports = [...main.matchAll(/^import\s.*$/gm)].map((m) => m[0]);
    expect(imports[0]).toBe('import "./zod-jitless";');
    expect(readFileSync(path.join(SRC, "zod-jitless.ts"), "utf8")).toMatch(/z\.config\(\{ jitless: true \}\);/);
  });

  test("the module imports nothing that builds a schema", () => {
    const source = readFileSync(path.join(SRC, "zod-jitless.ts"), "utf8");
    expect([...source.matchAll(/^import\s.*$/gm)].map((m) => m[0])).toEqual(['import { z } from "zod";']);
  });

  test("loading it turns zod's eval probe off", async () => {
    await import("../src/zod-jitless");
    expect(z.config().jitless).toBe(true);
  });
});
```

### Create `apps/admin/test/step-up.test.ts`

```ts
import { STAFF_STEP_UP_CHALLENGE } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import { checkStepUpOptions, revokeSessionWithKey, sessionRevokeAction, StepUpMismatch } from "../src/step-up";
import { envelope, fakeCredentials, fakeFetch, OTHER_SESSION, revokeAction, SESSION_HANDLE, stepUpChallenge, stepUpOptions } from "./fixtures";

/**
 * The check of step-up options before the key is asked (3a design, section 9): the challenge must be the 74 bytes of the
 * contracts' layout with the staff_step_up purpose, bound to this session's handle and the hash of exactly the action the
 * page chose, and the allow list must hold one key; otherwise navigator.credentials.get is never called.
 */
const TARGET = "4f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
const THIRD = "0d4c7b9e-1f36-4e2d-9a10-6c3b4f5e8a21";
const action = revokeAction(TARGET);

/** The whole confirmation as the home screen runs it, over a fake API that answers the step-up options with `options`. */
async function revokeWith(options: unknown) {
  const fake = fakeFetch({
    "POST /api/staff/step-up/options": { status: 200, body: options },
    [`DELETE /api/staff/sessions/${TARGET}`]: { status: 204 },
  });
  const credentials = fakeCredentials();
  const api = createStaffApi({ fetch: fake.fetch, cookie: () => "__Host-korbat_staff_csrf=t" });
  const outcome = await revokeSessionWithKey({ api, credentials }, SESSION_HANDLE, TARGET).catch((err: unknown) => err);
  return { outcome, credentials, requests: fake.requests };
}

describe("the check of step-up options", () => {
  test("options bound to this session and this action pass", async () => {
    const options = stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action)).options;
    await expect(checkStepUpOptions(options, SESSION_HANDLE, action)).resolves.toBeUndefined();
  });

  const refusals: [string, () => Promise<unknown>][] = [
    ["a challenge of another length (the other ceremonies' 58 bytes)", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action, { bytes: 58 }))],
    ["a challenge one byte longer", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action, { bytes: STAFF_STEP_UP_CHALLENGE.bytes + 1 }))],
    ["a challenge of another purpose (an app sign-in's)", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action, { purpose: 1 }))],
    ["a challenge of another version", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action, { version: 2 }))],
    ["a binding for another action", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, { ...action, action: "staff_key_revoked" }))],
    ["a binding for another target", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, revokeAction(THIRD)))],
    ["a binding for another target type", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, { ...action, target: { type: "staff_key", id: TARGET } }))],
    ["a binding for other params", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, { ...action, params: { all: true } }))],
    ["a binding for another session's handle", async () => stepUpOptions(await stepUpChallenge(OTHER_SESSION, action))],
    ["an allow list of two keys", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action), ["Y3JlZGVudGlhbC0x", "c2Vjb25k"])],
    ["an empty allow list, which lets the browser offer any key", async () => stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action), [])],
    ["no allow list at all", async () => ({ options: { challenge: await stepUpChallenge(SESSION_HANDLE, action), rpId: "localhost", userVerification: "required" } })],
  ];

  for (const [name, make] of refusals) {
    test(`refused before the key is asked: ${name}`, async () => {
      const options = (await make()) as { options: Parameters<typeof checkStepUpOptions>[0] };
      await expect(checkStepUpOptions(options.options, SESSION_HANDLE, action)).rejects.toBeInstanceOf(StepUpMismatch);
      const run = await revokeWith(options);
      expect(run.outcome).toBeInstanceOf(StepUpMismatch);
      expect(run.credentials.calls).toEqual([]);
      // The options were asked for, and nothing was sent after them.
      expect(run.requests.map((r) => r.method)).toEqual(["POST"]);
    });
  }
});

describe("revoking another session with the key", () => {
  test("the action is a lower-case staff session target with no params", () => {
    expect(sessionRevokeAction(TARGET.toUpperCase())).toEqual(action);
  });

  test("asks for options for exactly that action, asks the key once, then sends its assertion", async () => {
    const run = await revokeWith(stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action)));
    expect(run.outcome).toBe("revoked");
    expect(run.credentials.calls.map((c) => c.kind)).toEqual(["get"]);
    expect(run.requests.map((r) => `${r.method} ${r.url} ${r.headers["x-staff-activity"]}`)).toEqual([
      "POST /api/staff/step-up/options 1",
      `DELETE /api/staff/sessions/${TARGET} 1`,
    ]);
    expect(run.requests[0]!.body).toEqual(action);
    expect(run.requests[1]!.body).toMatchObject({ stepUp: { id: "Y3JlZGVudGlhbC0x", type: "public-key" } });
    expect(Object.keys(run.requests[1]!.body as object)).toEqual(["stepUp"]);
  });

  test("a session already gone is no error", async () => {
    const fake = fakeFetch({
      "POST /api/staff/step-up/options": { status: 200, body: stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action)) },
      [`DELETE /api/staff/sessions/${TARGET}`]: { status: 404, body: envelope("not_found") },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    await expect(revokeSessionWithKey({ api, credentials: fakeCredentials() }, SESSION_HANDLE, TARGET)).resolves.toBe("gone");
  });

  test("a confirmation the API refuses is its error", async () => {
    const fake = fakeFetch({
      "POST /api/staff/step-up/options": { status: 200, body: stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action)) },
      [`DELETE /api/staff/sessions/${TARGET}`]: { status: 403, body: envelope("staff_step_up_invalid") },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    await expect(revokeSessionWithKey({ api, credentials: fakeCredentials() }, SESSION_HANDLE, TARGET)).rejects.toMatchObject({ code: "staff_step_up_invalid" });
  });
});
```

### Create `apps/admin/test/store.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import { createConsoleStore, type ConsoleState } from "../src/store";
import { envelope, FakeClock, fakeFetch, makeMe, settle } from "./fixtures";

/**
 * The console's state across screens (3a design, section 9): which session the page holds, at which path. Any
 * staff_session_required answer shows sign-in in place and keeps the path; after the sign-in the console returns to it.
 */
const MIN = 60_000;

function setup(path: string, table: Parameters<typeof fakeFetch>[0], cookie = "__Host-korbat_staff_csrf=t") {
  const fake = fakeFetch(table);
  const api = createStaffApi({ fetch: fake.fetch, cookie: () => cookie });
  const clock = new FakeClock();
  const history: string[] = [];
  const store = createConsoleStore({
    api,
    clock,
    path,
    history: {
      pushState: (_data, _unused, url) => history.push(`push ${url}`),
      replaceState: (_data, _unused, url) => history.push(`replace ${url}`),
    },
  });
  const states: ConsoleState[] = [];
  store.subscribe(() => states.push(store.get()));
  return { store, clock, history, requests: fake.requests, states };
}

describe("the console's state", () => {
  test("opening a page reads /me as its person's action, and a live session shows the page", async () => {
    const s = setup("/audit", { "GET /api/staff/me": { status: 200, body: makeMe() } });
    expect(s.store.get().session).toEqual({ kind: "checking" });
    await s.store.start();
    expect(s.store.get()).toMatchObject({ path: "/audit", route: { name: "audit" }, session: { kind: "signed-in", me: makeMe() } });
    expect(s.requests.map((r) => `${r.url} ${r.headers["x-staff-activity"]}`)).toEqual(["/api/staff/me 1"]);
  });

  test("with no staff session at all the page shows sign-in in place, not as an ended session", async () => {
    // No staff CSRF cookie: this browser never signed in, or signed out, or the session's 12 hours are over.
    const s = setup("/audit", { "GET /api/staff/me": { status: 401, body: envelope("staff_session_required") } }, "__Host-korbat_csrf=app-token");
    await s.store.start();
    expect(s.store.get()).toMatchObject({ path: "/audit", session: { kind: "signed-out", ended: false } });
    expect(s.history).toEqual([]);
  });

  test("reopened after its session ended while no page held it (a reload or a new tab after an idle-out), sign-in says it ended", async () => {
    // The request carried the staff CSRF cookie, which only a sign-in sets and only a sign-out or this 401 clears.
    const s = setup("/audit", { "GET /api/staff/me": { status: 401, body: envelope("staff_session_required") } });
    await s.store.start();
    expect(s.requests[0]!.headers["x-staff-csrf"]).toBe("t");
    expect(s.store.get()).toMatchObject({ path: "/audit", route: { name: "audit" }, session: { kind: "signed-out", ended: true } });
    expect(s.history).toEqual([]);
    s.store.signedIn(makeMe());
    expect(s.store.get()).toMatchObject({ path: "/audit", session: { kind: "signed-in" } });
    expect(s.history).toEqual([]);
  });

  test("a page that held the session says it ended even when another tab's 401 already cleared the cookie", async () => {
    let cookie = "__Host-korbat_staff_csrf=t";
    const fake = fakeFetch({ "GET /api/staff/me": { status: 200, body: makeMe() }, "GET /api/staff/keys": { status: 401, body: envelope("staff_session_required") } });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => cookie });
    const store = createConsoleStore({ api, clock: new FakeClock(), path: "/", history: { pushState: () => undefined, replaceState: () => undefined } });
    await store.start();
    cookie = "";
    await api.keys({ activity: true }).catch(() => undefined);
    expect(store.get().session).toEqual({ kind: "signed-out", ended: true });
    store.dispose();
  });

  test("a 404 from /me is a console that is off or opened at another address", async () => {
    const s = setup("/", { "GET /api/staff/me": { status: 404, body: envelope("not_found") } });
    await s.store.start();
    expect(s.store.get().session).toEqual({ kind: "unavailable" });
  });

  test("another failure says so and can be tried again", async () => {
    const s = setup("/", { "GET /api/staff/me": [{ status: 503, body: envelope("internal") }, { status: 200, body: makeMe() }] });
    await s.store.start();
    expect(s.store.get().session).toMatchObject({ kind: "failed" });
    await s.store.start();
    expect(s.store.get().session).toMatchObject({ kind: "signed-in" });
  });

  test("the enrolment page reads no session", async () => {
    const s = setup("/enroll/abc", {});
    await s.store.start();
    expect(s.requests).toEqual([]);
    expect(s.store.get()).toMatchObject({ route: { name: "enroll", token: "abc" }, session: { kind: "signed-out", ended: false } });
  });

  test("sign-in in place on a 401 from the idle timer's read, then back to the same path", async () => {
    const s = setup("/audit", {
      "GET /api/staff/me": [
        { status: 200, body: makeMe() },
        { status: 401, body: envelope("staff_session_required") },
      ],
    });
    await s.store.start();
    await s.clock.advance(13 * MIN);
    // The timer's read carries no mark, and its 401 ended the session in place: same path, nothing pushed.
    expect(s.requests.map((r) => r.headers["x-staff-activity"])).toEqual(["1", undefined]);
    expect(s.store.get()).toMatchObject({ path: "/audit", route: { name: "audit" }, session: { kind: "signed-out", ended: true }, warning: null });
    expect(s.history).toEqual([]);
    expect(s.clock.pending).toBe(0);
    s.store.signedIn(makeMe());
    expect(s.store.get()).toMatchObject({ path: "/audit", session: { kind: "signed-in" } });
    expect(s.history).toEqual([]);
  });

  test("a 401 on any screen's request ends the session in place too", async () => {
    const s = setup("/", { "GET /api/staff/me": { status: 200, body: makeMe() }, "GET /api/staff/keys": { status: 401, body: envelope("staff_session_required") } });
    await s.store.start();
    s.store.navigate("/audit");
    expect(s.history).toEqual(["push /audit"]);
    await s.store.api.keys({ activity: true }).catch(() => undefined);
    expect(s.store.get()).toMatchObject({ path: "/audit", session: { kind: "signed-out", ended: true } });
  });

  test("a sign-in from /signin goes home, by replacing the address", async () => {
    const s = setup("/signin", { "GET /api/staff/me": { status: 401, body: envelope("staff_session_required") } });
    await s.store.start();
    s.store.signedIn(makeMe());
    expect(s.store.get()).toMatchObject({ path: "/", route: { name: "home" }, session: { kind: "signed-in" } });
    expect(s.history).toEqual(["replace /"]);
  });

  test("opening /signin with a live session goes home", async () => {
    const s = setup("/signin", { "GET /api/staff/me": { status: 200, body: makeMe() } });
    await s.store.start();
    expect(s.store.get().path).toBe("/");
    expect(s.history).toEqual(["replace /"]);
  });

  test("signing out shows the sign-in page, and the timer stops", async () => {
    const s = setup("/", { "GET /api/staff/me": { status: 200, body: makeMe() } });
    await s.store.start();
    s.store.signedOut();
    expect(s.store.get()).toMatchObject({ path: "/signin", session: { kind: "signed-out", ended: false } });
    expect(s.history).toEqual(["push /signin"]);
    expect(s.clock.pending).toBe(0);
  });

  test("the warning, then Stay signed in: one marked /me, which clears it", async () => {
    const s = setup("/", {
      "GET /api/staff/me": [
        { status: 200, body: makeMe() },
        { status: 200, body: makeMe({ idle: 120 }) },
        { status: 200, body: makeMe({ idle: 900 }) },
      ],
    });
    await s.store.start();
    await s.clock.advance(13 * MIN);
    expect(s.store.get().warning).toEqual({ kind: "idle" });
    await s.store.stay();
    expect(s.store.get().warning).toBeNull();
    expect(s.requests.map((r) => r.headers["x-staff-activity"])).toEqual(["1", undefined, "1"]);
    await s.clock.advance(13 * MIN - 1);
    expect(s.requests).toHaveLength(3);
  });

  test("a marked success on any screen restarts the timer", async () => {
    const s = setup("/", {
      "GET /api/staff/me": [{ status: 200, body: makeMe() }, { status: 200, body: makeMe({ idle: 120 }) }],
      "GET /api/staff/keys": { status: 200, body: { keys: [] } },
    });
    await s.store.start();
    await s.clock.advance(10 * MIN);
    await s.store.api.keys({ activity: true });
    await s.clock.advance(12 * MIN);
    expect(s.requests.map((r) => r.url)).toEqual(["/api/staff/me", "/api/staff/keys"]);
    await s.clock.advance(1 * MIN);
    expect(s.requests.map((r) => r.url)).toEqual(["/api/staff/me", "/api/staff/keys", "/api/staff/me"]);
  });

  test("going back and forward follows the address", async () => {
    const s = setup("/", { "GET /api/staff/me": { status: 200, body: makeMe() } });
    await s.store.start();
    s.store.popped("/audit");
    expect(s.store.get().route).toEqual({ name: "audit" });
    await settle();
    expect(s.history).toEqual([]);
  });
});
```

### Create `apps/admin/test/webauthn.test.ts`

```ts
import { randomBytes } from "node:crypto";
import { AuthenticationResponseJSON, RegistrationResponseJSON } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import {
  authenticationResponseToJSON,
  CeremonyError,
  ceremonyFailure,
  creationOptionsFromJSON,
  fromBase64url,
  registrationResponseToJSON,
  requestOptionsFromJSON,
  toBase64url,
} from "../src/webauthn";
import { enrollOptions, fakeAssertion, fakeAttestation, stepUpOptions } from "./fixtures";

/**
 * The console has no WebAuthn library: it turns the server library's JSON options into the browser's and the browser's
 * credential back into the JSON the contracts describe, with base64url of its own.
 */
const bytes = (view: BufferSource): Buffer => Buffer.from(view instanceof ArrayBuffer ? view : view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));

describe("base64url", () => {
  test("agrees with Node's on every length", () => {
    for (let length = 0; length < 70; length++) {
      const data = randomBytes(length);
      expect(toBase64url(new Uint8Array(data))).toBe(data.toString("base64url"));
      expect(Buffer.from(fromBase64url(data.toString("base64url")))).toEqual(data);
    }
  });

  test("refuses anything that is not unpadded base64url", () => {
    for (const text of ["a+b", "a/b", "ab==", "a b", "a", "%3C"]) expect(() => fromBase64url(text), text).toThrow();
  });
});

describe("options from the server's JSON", () => {
  test("registration: the challenge, the user handle and the excluded keys become bytes; the rest passes", () => {
    const json = enrollOptions(false).options;
    const options = creationOptionsFromJSON(json);
    expect(bytes(options.challenge)).toEqual(Buffer.alloc(58, 3));
    expect(bytes(options.user.id)).toEqual(Buffer.alloc(32, 9));
    expect(options.user).toMatchObject({ name: "Blue key", displayName: "Blue key" });
    expect(options.rp).toEqual({ id: "localhost", name: "korbat" });
    expect(options.excludeCredentials?.map((c) => bytes(c.id).toString("base64url"))).toEqual(["b2xkLWtleQ"]);
    expect(options.pubKeyCredParams.map((p) => p.alg)).toEqual([-8, -7, -257]);
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    expect(options.attestation).toBe("none");
    expect((options as unknown as { hints: string[] }).hints).toEqual(["security-key"]);
  });

  test("registration always asks for user verification, whatever the options said", () => {
    const json = { ...enrollOptions(false).options, authenticatorSelection: { residentKey: "required", userVerification: "discouraged" } };
    expect(creationOptionsFromJSON(json).authenticatorSelection?.userVerification).toBe("required");
  });

  test("an assertion: the challenge and the allowed keys become bytes, and user verification is required", () => {
    const json = { ...stepUpOptions("AAAA").options, userVerification: "preferred" };
    const options = requestOptionsFromJSON(json);
    expect(bytes(options.challenge)).toEqual(Buffer.from("AAAA", "base64url"));
    expect(options.allowCredentials?.map((c) => bytes(c.id).toString("base64url"))).toEqual(["Y3JlZGVudGlhbC0x"]);
    expect(options.rpId).toBe("localhost");
    expect(options.userVerification).toBe("required");
  });

  test("options the console cannot read are refused", () => {
    expect(() => creationOptionsFromJSON({ challenge: "AAAA" })).toThrow(CeremonyError);
    expect(() => requestOptionsFromJSON({ challenge: "AAAA", allowCredentials: [{ id: "a+b", type: "public-key" }] })).toThrow(CeremonyError);
  });
});

describe("the browser's credential as JSON", () => {
  test("a registration matches the contracts' RegistrationResponseJSON", () => {
    const json = registrationResponseToJSON(fakeAttestation());
    expect(RegistrationResponseJSON.parse(json)).toEqual(json);
    expect(json).toMatchObject({ id: "bmV3LWtleQ", rawId: "bmV3LWtleQ", type: "public-key", response: { transports: ["usb", "nfc"] }, clientExtensionResults: { credProps: { rk: true } } });
    // The browser reported no attachment: the member is left out, as the contracts' schema allows, rather than sent as null.
    expect("authenticatorAttachment" in json).toBe(false);
  });

  test("an assertion matches the contracts' AuthenticationResponseJSON", () => {
    const json = authenticationResponseToJSON(fakeAssertion());
    expect(AuthenticationResponseJSON.parse(json)).toEqual(json);
    expect(json.response.signature).toBe(Buffer.from("signature").toString("base64url"));
    expect(json.response.userHandle).toBe(Buffer.from("user-handle").toString("base64url"));
    expect(json.authenticatorAttachment).toBe("cross-platform");
  });

  test("no credential, or one of another shape, is a ceremony that did not finish", () => {
    expect(() => authenticationResponseToJSON(null)).toThrow(CeremonyError);
    expect(() => authenticationResponseToJSON(fakeAttestation())).toThrow(CeremonyError);
    expect(() => registrationResponseToJSON(fakeAssertion())).toThrow(CeremonyError);
  });
});

describe("the browser's refusals", () => {
  const domError = (name: string) => Object.assign(new Error("x"), { name });

  test("each is worded by the console, never passed through", () => {
    expect(ceremonyFailure(domError("NotAllowedError")).code).toBe("ceremony_cancelled");
    expect(ceremonyFailure(domError("AbortError")).code).toBe("ceremony_cancelled");
    expect(ceremonyFailure(domError("InvalidStateError")).code).toBe("key_already_registered");
    expect(ceremonyFailure(domError("SecurityError")).code).toBe("ceremony_refused");
    expect(ceremonyFailure(domError("NotSupportedError")).code).toBe("ceremony_refused");
    expect(ceremonyFailure(new TypeError("x")).code).toBe("ceremony_refused");
  });
});
```

### Create `apps/admin/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

/**
 * The console's tests run in Node: screens are server-rendered with react-dom/server, the page's logic is called with a
 * fake fetch and a clock the test moves, and the build and the development server run for real on temporary folders.
 * Times are shown in the browser's time zone, so the tests fix one.
 */
export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.{ts,tsx}"], env: { TZ: "UTC" } },
});
```

## Step 2: run the tests and watch them fail

```bash
cd apps/admin && node ../../node_modules/vitest/vitest.mjs run
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
❯ test/source.test.ts (23 tests | 5 failed) 43ms
Test Files  13 failed (13)
Tests  5 failed | 18 passed (23)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/06-staff-console.md 3
```

Expected: 38 lines starting with `wrote`, one for each file below.

### Create `apps/admin/build.d.mts`

```text
// Types for build.mjs, which the tests import; the script itself runs in Node without a compiler.
import type { BuildOptions } from "esbuild";

export declare const BUILD_TARGET: string[];
export declare function buildOptions(outdir: string): BuildOptions;
export declare function buildConsole(options?: { outdir?: string }): Promise<void>;
```

### Create `apps/admin/build.mjs`

```js
// Builds the staff console for Caddy's image (3a design, section 9). esbuild is called directly, as the API's build
// is: the whole configuration fits here. The development server (dev.mjs) runs the same options in watch mode.
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * The oldest browsers whose syntax the bundle is written for, pinned so that a new esbuild never changes the output by
 * itself. Each runs WebAuthn with user verification; one without Trusted Types ignores that part of the policy.
 */
export const BUILD_TARGET = ["chrome120", "edge120", "firefox121", "safari17"];

/**
 * The page. It holds no inline script or style, which the console's policy would refuse: one stylesheet and one module,
 * both under hashed names, and the icon as a file (img-src 'self' allows no data: URL).
 */
function indexHtml(script, style) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>korbat staff console</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/${style}">
<script type="module" src="/assets/${script}"></script>
</head>
<body>
<div id="root"></div>
<noscript>The staff console needs JavaScript.</noscript>
</body>
</html>
`;
}

/**
 * Writes index.html for a finished build and removes the hashed files an earlier build of the same folder left, so a
 * watch never serves yesterday's bundle. Runs at the end of every build, the development server's rebuilds included.
 */
function writePage(outdir) {
  return {
    name: "korbat-console-page",
    setup(pluginBuild) {
      pluginBuild.onEnd(async (result) => {
        if (result.errors.length > 0 || !result.metafile) return;
        const outputs = Object.entries(result.metafile.outputs);
        const entry = outputs.find(([, output]) => output.entryPoint === "src/main.tsx");
        if (!entry || !entry[1].cssBundle) throw new Error("the console's build produced no bundle or no stylesheet");
        const written = new Set(outputs.map(([file]) => path.basename(file)));
        for (const file of await readdir(path.join(outdir, "assets"))) {
          if (!written.has(file)) await rm(path.join(outdir, "assets", file), { force: true });
        }
        await copyFile(path.join(ROOT, "public", "favicon.svg"), path.join(outdir, "favicon.svg"));
        await writeFile(path.join(outdir, "index.html"), indexHtml(path.basename(entry[0]), path.basename(entry[1].cssBundle)));
      });
    },
  };
}

/** esbuild's options for a build into `outdir`: the page at its root, the hashed bundle and stylesheet under assets/. */
export function buildOptions(outdir) {
  return {
    absWorkingDir: ROOT,
    entryPoints: { main: "src/main.tsx" },
    outdir: path.join(outdir, "assets"),
    entryNames: "[name]-[hash]",
    assetNames: "[name]-[hash]",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: BUILD_TARGET,
    minify: true,
    jsx: "automatic",
    // React's production build: no development checks, and none of the development build's extra code in the page.
    define: { "process.env.NODE_ENV": '"production"' },
    // Licence comments stay, at the end of the bundle.
    legalComments: "eof",
    metafile: true,
    logLevel: "info",
    plugins: [writePage(outdir)],
  };
}

/** Builds the console into `outdir` (dist/ by default), from scratch. */
export async function buildConsole({ outdir = path.join(ROOT, "dist") } = {}) {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(path.join(outdir, "assets"), { recursive: true });
  await build(buildOptions(outdir));
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await buildConsole();
  console.log("Build success");
}
```

### Create `apps/admin/dev-server.d.mts`

```text
// Types for dev-server.mjs, which the tests import; the script itself runs in Node without a compiler.
import type { Server } from "node:http";

export declare function createDevServer(options: { dist: string; api: string }): Server;
export declare function parsePort(args: string[]): number;
```

### Create `apps/admin/dev-server.mjs`

```js
// The console's development server (3a design, section 13, Task 6): it serves the build with the console site's headers
// and forwards /api/staff/* to the API, as Caddy's console site does in the stack. dev.mjs runs it beside esbuild's watch.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, request } from "node:http";
import path from "node:path";
import { consoleSiteHeaders } from "./site-headers.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

/** Headers that belong to one connection, never forwarded. */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authorization", "proxy-authenticate"]);

const isStaffApi = (pathname) => pathname === "/api/staff" || pathname.startsWith("/api/staff/");

/**
 * The file a request names inside `dist`, or null. The path is decoded once and must stay inside the folder: a dot
 * segment, an encoded slash or a backslash that would leave it is refused, and the page is served instead.
 */
async function fileFor(dist, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes(String.fromCharCode(0))) return null;
  const file = path.resolve(dist, `.${path.posix.normalize(decoded.split(path.sep).join("/"))}`);
  if (file !== dist && !file.startsWith(dist + path.sep)) return null;
  const info = await stat(file).catch(() => null);
  return info?.isFile() ? file : null;
}

/** Answers with an error envelope, as the API would. */
function apiError(res, status, code, message) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: { code, message } }));
}

/**
 * The server: `dist` is the build's folder, `api` the API's origin. /api/staff and /api/staff/* go to the API with their
 * method, path, query, headers and body, and the Host header kept, so the staff gate sees the console's host as it does
 * behind Caddy; the API's answer comes back untouched. Any other /api path is 404. Everything else is a file of the
 * build with the console site's headers, and index.html for any path that is not one, so the router's pages load.
 */
export function createDevServer({ dist, api }) {
  const root = path.resolve(dist);
  const upstream = new URL(api);
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://console.invalid");

    if (isStaffApi(url.pathname)) {
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !HOP_BY_HOP.has(name)));
      const forward = request({ host: upstream.hostname, port: upstream.port || 80, method: req.method, path: req.url, headers }, (answer) => {
        const back = Object.fromEntries(Object.entries(answer.headers).filter(([name]) => !HOP_BY_HOP.has(name)));
        res.writeHead(answer.statusCode ?? 502, back);
        answer.pipe(res);
      });
      forward.on("error", () => {
        if (!res.headersSent) apiError(res, 502, "internal", `The API at ${api} is not answering: start it with pnpm --filter @korbat/api dev.`);
        else res.destroy();
      });
      req.pipe(forward);
      return;
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return apiError(res, 404, "not_found", "Not found");

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      return res.end();
    }

    const file = (await fileFor(root, url.pathname)) ?? path.join(root, "index.html");
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      return res.end("The console is still building; reload in a moment.");
    }
    // The page's headers go with every static answer; a hashed file is the only one kept for long.
    const served = file === path.join(root, "index.html") ? "/" : url.pathname;
    res.writeHead(200, { ...consoleSiteHeaders(served), "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-length": info.size });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  });
}

/** The port from the command line: --port N or --port=N, 8090 by default. */
export function parsePort(args) {
  let port = 8090;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") continue;
    let value;
    if (arg === "--port") value = args[++i];
    else if (arg.startsWith("--port=")) value = arg.slice("--port=".length);
    else throw new Error(`unknown argument ${arg}; the only one is --port <number>`);
    if (value === undefined || !/^[0-9]{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error("--port needs a port number from 1 to 65535");
    port = Number(value);
  }
  return port;
}
```

### Create `apps/admin/dev.mjs`

```js
// `pnpm --filter @korbat/admin dev [--port <number>]`: the staff console beside the README's quick start. esbuild
// rebuilds dist/ on every change, with the production build's own options, and the development server serves it on
// 127.0.0.1:8090 with the console site's headers, forwarding /api/staff/* to the API at http://localhost:3000 with the
// Host header kept. Open it at http://localhost:8090, never 127.0.0.1: browsers refuse WebAuthn on an IP address, and
// the API's CONSOLE_ORIGIN (apps/api/.env) must name the same port.
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { context } from "esbuild";
import { buildOptions } from "./build.mjs";
import { createDevServer, parsePort } from "./dev-server.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const API = "http://localhost:3000";

let port;
try {
  port = parsePort(process.argv.slice(2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}

await rm(DIST, { recursive: true, force: true });
await mkdir(path.join(DIST, "assets"), { recursive: true });
const builder = await context(buildOptions(DIST));
await builder.watch();

const server = createDevServer({ dist: DIST, api: API });
server.listen(port, "127.0.0.1", () => {
  console.log(`The staff console: http://localhost:${port} (forwarding /api/staff/* to ${API}; CONSOLE_ORIGIN must be http://localhost:${port})`);
});

const stop = async () => {
  server.close();
  await builder.dispose();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
```

### Create `apps/admin/public/favicon.svg`

```text
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#991b1b"/><path d="M11 7v18M11 18l9-11M14 15l7 10" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

### Create `apps/admin/site-headers.d.mts`

```text
// Types for site-headers.mjs, which the tests import; the script itself runs in Node without a compiler.
export declare const CONSOLE_CSP: string;
export declare function isHashedPath(pathname: string): boolean;
export declare function consoleSiteHeaders(pathname: string): Record<string, string>;
```

### Create `apps/admin/site-headers.mjs`

```js
// The headers of Caddy's console site (3a design, sections 3 and 8), which the development server sends too, so the
// console runs locally under the same policy as in production.

/**
 * The page's Content Security Policy, measured in console-lab.md with zero reports: scripts, styles, images and requests
 * from the console's own origin only, no plugin, no base, no framing, forms only to itself, and Trusted Types required
 * with no policy allowed, so no HTML or script sink can be used at all.
 */
export const CONSOLE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; require-trusted-types-for 'script'; trusted-types 'none'";

/** The hashed bundle and stylesheet, which never change under their names. */
export const isHashedPath = (pathname) => pathname.startsWith("/assets/");

/**
 * The headers for a static file at `pathname`. Every answer that is not a hashed file (the page above all) is neither
 * stored nor transformed: no-transform stops Cloudflare injecting scripts the policy would block on every page view.
 */
export function consoleSiteHeaders(pathname) {
  return {
    "Content-Security-Policy": CONSOLE_CSP,
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    // WebAuthn for the console itself only; no camera, microphone or position for anyone.
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
    "Cache-Control": isHashedPath(pathname) ? "public, max-age=31536000, immutable" : "no-store, no-transform",
  };
}
```

### Create `apps/admin/src/App.tsx`

```tsx
import { useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import type { SignalApi } from "./enroll";
import { Layout, Masthead } from "./Layout";
import { describeError } from "./messages";
import { NavLink } from "./nav";
import type { ConsolePath } from "./router";
import { Audit } from "./screens/Audit";
import { Enroll } from "./screens/Enroll";
import { Home } from "./screens/Home";
import { SignIn } from "./screens/SignIn";
import { Unavailable } from "./screens/Unavailable";
import type { ConsoleStore } from "./store";
import type { CredentialsLike } from "./webauthn";

/**
 * The console's page (3a design, section 9): the screen for the address and the session. An enrolment link needs no
 * session; every other page shows sign-in in place while there is none, at its own address, and its own screen after.
 */
export function App({ store, credentials, signal }: { store: ConsoleStore; credentials: CredentialsLike; signal: SignalApi | undefined }) {
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const { api } = store;
  const { session, route } = state;

  if (session.kind === "unavailable") return <Unavailable />;

  if (route.name === "enroll") {
    return (
      <>
        <Masthead />
        <main>
          <Enroll token={route.token} api={api} credentials={credentials} signal={signal} onUnavailable={store.unavailable} />
        </main>
      </>
    );
  }

  if (session.kind !== "signed-in") {
    return (
      <>
        <Masthead />
        <main>
          {session.kind === "checking" ? <p className="quiet">Loading</p> : null}
          {session.kind === "failed" ? (
            <section className="panel">
              <p role="alert" className="error">
                {session.message}
              </p>
              <button type="button" onClick={() => void store.start()}>
                Try again
              </button>
            </section>
          ) : null}
          {session.kind === "signed-out" ? <SignIn ended={session.ended} api={api} credentials={credentials} onSignedIn={store.signedIn} onUnavailable={store.unavailable} /> : null}
        </main>
      </>
    );
  }

  const signOut = async () => {
    setSignOutError(null);
    try {
      await api.signOut({ activity: true });
      store.signedOut();
    } catch (err) {
      // A session that had already ended has shown sign-in through the 401; any other failure leaves the session as it was.
      if (!(err instanceof ApiError && err.code === "staff_session_required")) setSignOutError(describeError(err));
    }
  };

  const navigate = (path: ConsolePath) => {
    setSignOutError(null);
    store.navigate(path);
  };

  return (
    <Layout me={session.me} path={state.path} warning={state.warning} onNavigate={navigate} onSignOut={() => void signOut()} onStay={() => void store.stay()}>
      {signOutError ? (
        <p role="alert" className="error">
          {signOutError}
        </p>
      ) : null}
      {route.name === "home" || route.name === "signin" ? <Home me={session.me} api={api} credentials={credentials} /> : null}
      {route.name === "audit" ? <Audit api={api} /> : null}
      {route.name === "unknown" ? (
        <section aria-labelledby="unknown-title">
          <h2 id="unknown-title">No such page</h2>
          <p>There is no page at this address.</p>
          <p>
            <NavLink to="/" onNavigate={navigate}>
              Go to the home page
            </NavLink>
          </p>
        </section>
      ) : null}
    </Layout>
  );
}
```

### Create `apps/admin/src/Layout.tsx`

```tsx
import type { StaffMe } from "@korbat/contracts";
import type { ReactNode } from "react";
import type { IdleWarning } from "./idle";
import { NavLink } from "./nav";
import type { ConsolePath } from "./router";
import { clockTime, UserText } from "./ui";

/**
 * The idle timer's warnings (3a design, section 9), in a live region that is always on the page, so a warning is
 * announced when it appears. Before the idle end, "Stay signed in" sends one marked GET /api/staff/me; before the
 * absolute end there is no button, since nothing moves it.
 */
export function IdleNotice({ warning, onStay }: { warning: IdleWarning | null; onStay(): void }) {
  return (
    <div role="status" aria-live="polite" className={warning === null ? "idle" : "idle warning"}>
      {warning?.kind === "idle" ? (
        <>
          <p>Your staff session ends in 2 minutes.</p>
          <button type="button" onClick={onStay}>
            Stay signed in
          </button>
        </>
      ) : null}
      {warning?.kind === "absolute" ? <p>{`Your staff session ends at ${clockTime(warning.endsAt)}. Sign in again with your staff key then.`}</p> : null}
    </div>
  );
}

/** The console's name, alone: the frame of the pages shown without a session. */
export function Masthead() {
  return (
    <header className="masthead">
      <h1>korbat staff console</h1>
    </header>
  );
}

/** The frame of every page behind a session: who is signed in, the console's pages, sign-out and the idle warnings. */
export function Layout({
  me,
  path,
  warning,
  onNavigate,
  onSignOut,
  onStay,
  children,
}: {
  me: StaffMe;
  path: string;
  warning: IdleWarning | null;
  onNavigate(path: ConsolePath): void;
  onSignOut(): void;
  onStay(): void;
  children: ReactNode;
}) {
  return (
    <>
      <header className="masthead">
        <h1>korbat staff console</h1>
        <nav aria-label="Console">
          <NavLink to="/" current={path === "/"} onNavigate={onNavigate}>
            Home
          </NavLink>
          <NavLink to="/audit" current={path === "/audit"} onNavigate={onNavigate}>
            Audit log
          </NavLink>
        </nav>
        <p className="who">
          <UserText>{me.handle}</UserText>, {me.role}
        </p>
        <button type="button" onClick={onSignOut}>
          Sign out
        </button>
      </header>
      <IdleNotice warning={warning} onStay={onStay} />
      <main>{children}</main>
    </>
  );
}
```

### Create `apps/admin/src/api.ts`

```ts
import {
  AuditPage,
  ErrorEnvelope,
  StaffEnrollOptionsResponse,
  StaffEnrollVerifyResponse,
  StaffKeysResponse,
  StaffMe,
  StaffSessionsResponse,
  StaffSignInOptionsResponse,
  StaffSignInVerifyResponse,
  StaffStepUpOptionsResponse,
  type StaffEnrollOptionsRequest,
  type StaffEnrollVerifyRequest,
  type StaffSessionRevokeRequest,
  type StaffSignInVerifyRequest,
  type StaffStepUpOptionsRequest,
} from "@korbat/contracts";
import type { z } from "zod";
import { messageFor } from "./messages";

/**
 * The console's calls to its API (3a design, sections 7 and 9). Every call goes to /api/staff/* on the console's own
 * origin, with the staff session's cookies. Each echoes the staff CSRF cookie in x-staff-csrf (the API requires it on
 * every write), sends X-Staff-Activity: 1 only when its caller says a person's action started it, and parses the answer
 * with the contracts' schema, so nothing the page shows is anything but what the contracts describe.
 */

/** The staff CSRF cookie, which the page can read and the API compares with the header; never the app's. */
export const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
export const STAFF_CSRF_HEADER = "x-staff-csrf";
/** The mark of a request a person's action started: only such a request moves the session's idle end. */
export const STAFF_ACTIVITY_HEADER = "x-staff-activity";

/** A failed call: the API's code, or the console's own (network, invalid_answer), with the console's words for it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string = messageFor(code),
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** What the API client runs on: the page's fetch and cookies, or a test's. */
export interface StaffApiDeps {
  fetch(input: string, init: RequestInit): Promise<Response>;
  cookie(): string;
}

/**
 * What the store listens for. Any staff_session_required answer means the API has already cleared both staff cookies,
 * so the store shows sign-in in place; a marked request that succeeded restarts the idle timer.
 */
export interface ApiHooks {
  /**
   * `carriedStaffCookie`: the refused request carried the staff CSRF cookie. Only a sign-in sets it, for the session's
   * 12 hours, and only a sign-out or a staff_session_required answer clears it, so a request that carried it was made
   * for a session that has now ended, even when no page held that session (a reload or a new tab after an idle-out).
   */
  onSessionRequired(carriedStaffCookie: boolean): void;
  onActivity(): void;
}

/** A call's options: `activity` is true only when a person's action (a click, a form, opening a screen) started it. */
export interface Call {
  activity?: boolean;
}

/** The audit reader's query: newest, before a cursor, or the page whose newest row is at a place; and its one filter. */
export interface AuditQuery {
  action?: "staff_sign_in";
  cursor?: number;
  at?: number;
}

/** A cookie's value by its exact name, from a document.cookie string. */
export function readCookie(cookies: string, name: string): string | undefined {
  for (const part of cookies.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator > 0 && trimmed.slice(0, separator) === name) {
      try {
        return decodeURIComponent(trimmed.slice(separator + 1));
      } catch {
        return trimmed.slice(separator + 1);
      }
    }
  }
  return undefined;
}

export type StaffApi = ReturnType<typeof createStaffApi>;

export function createStaffApi(deps: StaffApiDeps) {
  const hooks: ApiHooks = { onSessionRequired: () => undefined, onActivity: () => undefined };

  /**
   * One request. `schema` parses a 2xx answer; null means the route answers 204 with no body. A non-2xx answer becomes an
   * ApiError with the envelope's code (or not_found and internal when there is none), worded by the console.
   */
  async function request<T>(method: "GET" | "POST" | "DELETE", path: string, schema: z.ZodType<T> | null, call: Call, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    const csrf = readCookie(deps.cookie(), STAFF_CSRF_COOKIE);
    if (csrf) headers[STAFF_CSRF_HEADER] = csrf;
    if (call.activity === true) headers[STAFF_ACTIVITY_HEADER] = "1";
    if (body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    try {
      // Same origin only, never cached, and never redirected: the staff API answers every request itself.
      response = await deps.fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new ApiError(0, "network");
    }

    if (!response.ok) {
      const envelope = ErrorEnvelope.safeParse(await response.json().catch(() => null));
      const code = envelope.success ? envelope.data.error.code : response.status === 404 ? "not_found" : "internal";
      // The API cleared both staff cookies with this answer; the store shows sign-in in place. The cookie is gone from
      // the page by now, so what the request carried, read before it was sent, is the only record that it was there.
      if (code === "staff_session_required") hooks.onSessionRequired(Boolean(csrf));
      throw new ApiError(response.status, code);
    }

    let value: T;
    if (schema === null) {
      value = undefined as T;
    } else {
      const parsed = schema.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success) throw new ApiError(response.status, "invalid_answer");
      value = parsed.data;
    }
    // Only a marked success restarts the idle timer. A refused request moved nothing; one that did move the idle end but
    // failed later, or whose answer the schemas refused, only makes the timer read /me early, and it follows the answer.
    if (call.activity === true) hooks.onActivity();
    return value;
  }

  const query = (q: AuditQuery): string => {
    // Fixed order, numbers only: nothing a person typed reaches the address unchecked.
    const params = new URLSearchParams();
    if (q.action !== undefined) params.set("action", q.action);
    if (q.cursor !== undefined) params.set("cursor", String(q.cursor));
    if (q.at !== undefined) params.set("at", String(q.at));
    const text = params.toString();
    return text === "" ? "" : `?${text}`;
  };

  return {
    hooks,
    me: (call: Call = {}) => request("GET", "/api/staff/me", StaffMe, call),
    sessions: (call: Call = {}) => request("GET", "/api/staff/sessions", StaffSessionsResponse, call),
    keys: (call: Call = {}) => request("GET", "/api/staff/keys", StaffKeysResponse, call),
    audit: (q: AuditQuery, call: Call = {}) => request("GET", `/api/staff/audit${query(q)}`, AuditPage, call),
    signOut: (call: Call = {}) => request<void>("POST", "/api/staff/signout", null, call),
    signInOptions: (call: Call = {}) => request("POST", "/api/staff/signin/options", StaffSignInOptionsResponse, call),
    signInVerify: (body: StaffSignInVerifyRequest, call: Call = {}) => request("POST", "/api/staff/signin/verify", StaffSignInVerifyResponse, call, body),
    enrollOptions: (body: StaffEnrollOptionsRequest, call: Call = {}) => request("POST", "/api/staff/enroll/options", StaffEnrollOptionsResponse, call, body),
    enrollVerify: (body: StaffEnrollVerifyRequest, call: Call = {}) => request("POST", "/api/staff/enroll/verify", StaffEnrollVerifyResponse, call, body),
    stepUpOptions: (body: StaffStepUpOptionsRequest, call: Call = {}) => request("POST", "/api/staff/step-up/options", StaffStepUpOptionsResponse, call, body),
    /** The handle must already be the lower-case uuid the step-up confirmed: it is the action's target. */
    revokeSession: (handle: string, body: StaffSessionRevokeRequest, call: Call = {}) =>
      request<void>("DELETE", `/api/staff/sessions/${encodeURIComponent(handle)}`, null, call, body),
  };
}
```

### Create `apps/admin/src/app.css`

```text
/*
 * The staff console's only stylesheet. The page's policy allows styles from its own files only (style-src 'self'), so
 * every rule is here and no component sets a style. Red marks the staff console apart from the app at a glance.
 */
:root {
  color-scheme: light dark;
  --bg: #fafaf9;
  --fg: #1c1917;
  --muted: #57534e;
  --line: #d6d3d1;
  --panel: #ffffff;
  --accent: #991b1b;
  --accent-fg: #ffffff;
  --error-bg: #fef2f2;
  --error-fg: #991b1b;
  --notice-bg: #fffbeb;
  --notice-fg: #78350f;
  --ok-bg: #f0fdf4;
  --ok-fg: #14532d;
  --focus: #2563eb;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0c0a09;
    --fg: #f5f5f4;
    --muted: #a8a29e;
    --line: #44403c;
    --panel: #1c1917;
    --accent: #dc2626;
    --error-bg: #450a0a;
    --error-fg: #fecaca;
    --notice-bg: #451a03;
    --notice-fg: #fde68a;
    --ok-bg: #052e16;
    --ok-fg: #bbf7d0;
    --focus: #60a5fa;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
}

.masthead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.5rem;
  padding: 0.75rem 1.5rem;
  border-top: 4px solid var(--accent);
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}

.masthead h1 {
  margin: 0;
  font-size: 1.1rem;
}

.masthead nav {
  display: flex;
  gap: 1rem;
}

.masthead .who {
  margin: 0 0 0 auto;
  color: var(--muted);
}

main {
  max-width: 72rem;
  margin: 0 auto;
  padding: 1.5rem;
}

.unavailable {
  max-width: 40rem;
  padding-top: 4rem;
}

.panel {
  max-width: 40rem;
}

h2 {
  font-size: 1.4rem;
  margin: 0 0 1rem;
}

h3 {
  font-size: 1.05rem;
  margin: 2rem 0 0.25rem;
}

a {
  color: var(--accent);
}

a[aria-current="page"] {
  font-weight: 600;
  text-decoration: none;
}

button {
  font: inherit;
  padding: 0.45rem 0.9rem;
  border: 1px solid var(--line);
  border-radius: 0.375rem;
  background: var(--panel);
  color: var(--fg);
  cursor: pointer;
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
}

button:disabled {
  opacity: 0.6;
  cursor: default;
}

button[aria-busy="true"] {
  cursor: progress;
}

a:focus-visible,
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

label {
  display: block;
  font-weight: 600;
  margin-top: 1.5rem;
}

input[type="text"] {
  font: inherit;
  width: 100%;
  max-width: 24rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--line);
  border-radius: 0.375rem;
  background: var(--panel);
  color: var(--fg);
}

input[aria-invalid="true"] {
  border-color: var(--error-fg);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1rem;
}

.hint,
.quiet {
  color: var(--muted);
}

.error {
  background: var(--error-bg);
  color: var(--error-fg);
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
}

.error p {
  margin: 0.25rem 0;
}

.notice {
  background: var(--ok-bg);
  color: var(--ok-fg);
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
}

.ended {
  font-weight: 600;
}

.idle.warning {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1.5rem;
  background: var(--notice-bg);
  color: var(--notice-fg);
}

.idle.warning p {
  margin: 0;
}

.place {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.place label {
  margin: 0;
}

.place input[type="text"] {
  width: 12rem;
}

.scroll {
  overflow-x: auto;
}

table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5rem 0 1rem;
}

th,
td {
  text-align: left;
  vertical-align: top;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--line);
}

code {
  font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 0.85em;
}

/* A hash is copied whole by the keeper, so it wraps anywhere rather than widening the table. */
.hash {
  word-break: break-all;
}

/* User-written text may be one long word. */
bdi {
  overflow-wrap: anywhere;
}

.signins,
.keys {
  padding-left: 1.25rem;
}

.later {
  margin-top: 2.5rem;
  color: var(--muted);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

### Create `apps/admin/src/audit-log.ts`

```ts
import { AuditPageQuery, type AuditPage } from "@korbat/contracts";
import type { StaffApi } from "./api";

/**
 * The audit log's reading (3a design, sections 2 and 9): newest first, "Load older" from a page's cursor, and "Go to
 * place", which opens the page whose newest row is at a place the keeper kept. Each read is a person's action.
 */

/**
 * A place as the keeper typed or pasted it, checked by the reader's own query schema (a positive whole number of at most
 * 15 digits), or null, which asks nothing of the API.
 */
export function parsePlace(text: string): number | null {
  const parsed = AuditPageQuery.safeParse({ at: text.trim() });
  return parsed.success && parsed.data.at !== undefined ? parsed.data.at : null;
}

export function createAuditReader(api: StaffApi) {
  return {
    newest: (): Promise<AuditPage> => api.audit({}, { activity: true }),
    older: (cursor: number): Promise<AuditPage> => api.audit({ cursor }, { activity: true }),
    at: (place: number): Promise<AuditPage> => api.audit({ at: place }, { activity: true }),
  };
}
```

### Create `apps/admin/src/css.d.ts`

```ts
// The entry imports its one stylesheet for esbuild to bundle; the import gives the script nothing.
declare module "*.css";
```

### Create `apps/admin/src/enroll.ts`

```ts
import type { StaffEnrollOptionsRequest, StaffKey } from "@korbat/contracts";
import { ApiError, type StaffApi } from "./api";
import { ceremonyFailure, creationOptionsFromJSON, registrationResponseToJSON, type CredentialsLike } from "./webauthn";

/**
 * Enrolling a staff key from the link `staff.js enroll` printed (3a design, sections 7 and 9): options for the key's name
 * and kind, the browser's registration, then the verify with the same token and name. A refusal never spends the link,
 * so the person can try another key until it expires.
 */

/**
 * The browser's Signal API, where it has it (Chrome and Edge 132+, Safari 26): a static method of PublicKeyCredential
 * that asks the password manager to drop a credential the relying party does not keep.
 */
export interface SignalApi {
  signalUnknownCredential?(options: { rpId: string; credentialId: string }): Promise<void>;
}

/**
 * How a refused key leaves the person's password manager: "signalled" when the browser was asked to drop it, "by-hand"
 * when the person must delete it themselves, "none" when nothing was made that needs dropping.
 */
export type Cleanup = "none" | "signalled" | "by-hand";

export type EnrollResult = { ok: true; key: StaffKey } | { ok: false; code: string; status: number; cleanup: Cleanup };

/** The two refusals that mean the browser made and kept a credential the console will never accept. */
const KEPT_BUT_REFUSED = new Set(["staff_key_not_device_bound", "staff_key_not_user_verified"]);

const failure = (err: unknown, cleanup: Cleanup = "none"): EnrollResult => {
  const known = err instanceof ApiError ? err : ceremonyFailure(err);
  return { ok: false, code: known.code, status: known.status, cleanup };
};

/**
 * Asks the password manager to drop a refused credential, but only when the enrolment options said the console's relying
 * party ID is not the app's (rpShared false). In development both are localhost, and WebKit's bugs 322267 and 302624
 * show the call deleting other passkeys of the same relying party, so there it is never made. Where the browser lacks the
 * call, or it fails, the person is told to delete the entry by hand.
 */
async function dropRefused(signal: SignalApi | undefined, rpShared: boolean, rpId: string | undefined, credentialId: string): Promise<Cleanup> {
  if (rpShared || rpId === undefined || typeof signal?.signalUnknownCredential !== "function") return "by-hand";
  try {
    await signal.signalUnknownCredential({ rpId, credentialId });
    return "signalled";
  } catch {
    return "by-hand";
  }
}

export async function enrollKey(deps: { api: StaffApi; credentials: CredentialsLike; signal: SignalApi | undefined }, input: StaffEnrollOptionsRequest): Promise<EnrollResult> {
  let rpShared: boolean;
  let options: Record<string, unknown>;
  let publicKey: PublicKeyCredentialCreationOptions;
  try {
    // Every request here is marked: the person pressed a button. No session exists yet, so nothing moves.
    const answer = await deps.api.enrollOptions(input, { activity: true });
    rpShared = answer.rpShared;
    options = answer.options;
    publicKey = creationOptionsFromJSON(options);
  } catch (err) {
    return failure(err);
  }

  let response;
  try {
    response = registrationResponseToJSON(await deps.credentials.create({ publicKey }));
  } catch (err) {
    return failure(err);
  }

  try {
    const { key } = await deps.api.enrollVerify({ token: input.token, name: input.name, response }, { activity: true });
    return { ok: true, key };
  } catch (err) {
    if (err instanceof ApiError && KEPT_BUT_REFUSED.has(err.code)) {
      const rp = options.rp as { id?: unknown } | undefined;
      return failure(err, await dropRefused(deps.signal, rpShared, typeof rp?.id === "string" ? rp.id : undefined, response.id));
    }
    return failure(err);
  }
}
```

### Create `apps/admin/src/idle.ts`

```ts
import type { StaffMe } from "@korbat/contracts";
import { ApiError } from "./api";

/**
 * The console's idle timer (3a design, section 9). The server holds the idle limit: a staff session ends 15 minutes
 * after the last request its person's action started (X-Staff-Activity: 1), never past its 12-hour absolute end. The
 * timer only follows that. It restarts at 15 minutes, or at the time left to the absolute end when that is less, whenever
 * a marked request succeeds. Two minutes before it runs out it reads GET /api/staff/me without the mark: more than two
 * minutes left means the person acted in another tab, and the timer is set from the answer; otherwise it warns. When it
 * runs out it reads /me once more and follows the answer, or the 401 shows sign-in. Its reads are the console's only
 * timed requests, and they never move the idle end themselves.
 */

export const IDLE_MS = 15 * 60_000;
export const WARNING_MS = 2 * 60_000;
/** The least wait before reading /me again once the timer ran out, so a session with a second left is not read in a loop. */
const RECHECK_MS = 1000;
/** When a read fails for a reason other than an ended session, the timer tries again this much later. */
const RETRY_MS = 30_000;

/** The warning on screen: the idle end, which "Stay signed in" moves, or the absolute end, which nothing moves. */
export type IdleWarning = { kind: "idle" } | { kind: "absolute"; endsAt: string };

/** A stopwatch and timers: the page's, or a test's that it moves by hand. Only differences between its readings matter. */
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export interface IdleTimerDeps {
  clock: Clock;
  /** GET /api/staff/me without the activity mark. A staff_session_required failure means sign-in is already showing. */
  readMe(): Promise<StaffMe>;
  onWarning(warning: IdleWarning | null): void;
  /** Each answer the timer read, so the page shows the session as the server now sees it. */
  onMe(me: StaffMe): void;
}

export interface IdleTimer {
  /** Sets the timer from a session's answer: at sign-in, and when the page opens on a live session. */
  start(me: StaffMe): void;
  /** A marked request succeeded: 15 minutes again, or what is left to the absolute end. Does nothing while stopped. */
  restart(): void;
  /** The session ended or was signed out: no more reads. */
  stop(): void;
}

const sameWarning = (a: IdleWarning | null, b: IdleWarning | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && (a.kind === "idle" || (b.kind === "absolute" && a.endsAt === b.endsAt)));

export function createIdleTimer(deps: IdleTimerDeps): IdleTimer {
  let running = false;
  // Both ends on the clock's own scale, set from the server's seconds left, never from the browser's time of day.
  let idleEnd = 0;
  let absoluteEnd = 0;
  let absoluteExpiresAt = "";
  let handle: unknown = null;
  // Every new plan bumps it, so a read that answers after a restart or a stop is ignored rather than undoing it.
  let generation = 0;
  let shown: IdleWarning | null = null;

  const show = (warning: IdleWarning | null) => {
    if (sameWarning(shown, warning)) return;
    shown = warning;
    deps.onWarning(warning);
  };

  const clear = () => {
    if (handle !== null) deps.clock.clearTimeout(handle);
    handle = null;
  };

  const schedule = (ms: number, phase: "warn" | "end") => {
    clear();
    const mine = generation;
    handle = deps.clock.setTimeout(() => {
      handle = null;
      void check(phase, mine);
    }, ms);
  };

  const fromMe = (me: StaffMe) => {
    const now = deps.clock.now();
    idleEnd = now + me.idleSecondsLeft * 1000;
    absoluteEnd = now + me.absoluteSecondsLeft * 1000;
    absoluteExpiresAt = me.absoluteExpiresAt;
  };

  /** Warns or not by the time left, and sets the next read: two minutes before the end, or at the end. */
  const plan = () => {
    generation += 1;
    const now = deps.clock.now();
    const warnAt = idleEnd - WARNING_MS;
    if (now < warnAt) {
      show(null);
      schedule(warnAt - now, "warn");
      return;
    }
    // The idle end never lies past the absolute one; when they meet, the absolute end is the one that comes.
    show(idleEnd >= absoluteEnd ? { kind: "absolute", endsAt: absoluteExpiresAt } : { kind: "idle" });
    schedule(Math.max(idleEnd - now, RECHECK_MS), "end");
  };

  const stop = () => {
    running = false;
    generation += 1;
    clear();
    show(null);
  };

  const check = async (phase: "warn" | "end", mine: number) => {
    let me: StaffMe;
    try {
      me = await deps.readMe();
    } catch (err) {
      if (mine !== generation || !running) return;
      // The API cleared the cookies and the page already shows sign-in, at the same path.
      if (err instanceof ApiError && err.code === "staff_session_required") return stop();
      // Unread for another reason (the network, a server error): go on with what the timer knew.
      if (phase === "warn") return plan();
      generation += 1;
      return schedule(RETRY_MS, "end");
    }
    if (mine !== generation || !running) return;
    deps.onMe(me);
    fromMe(me);
    plan();
  };

  return {
    start(me) {
      running = true;
      fromMe(me);
      plan();
    },
    restart() {
      if (!running) return;
      idleEnd = Math.min(deps.clock.now() + IDLE_MS, absoluteEnd);
      plan();
    },
    stop,
  };
}
```

### Create `apps/admin/src/main.tsx`

```tsx
import "./zod-jitless";
import { createRoot } from "react-dom/client";
import { createStaffApi } from "./api";
import { App } from "./App";
import type { SignalApi } from "./enroll";
import { systemClock } from "./idle";
import { createConsoleStore } from "./store";
import "./app.css";

// The staff console's entry (3a design, section 9). The first import makes zod jitless before the contracts build their
// schemas; esbuild keeps that order in the bundle. The page talks only to /api/staff/* on its own origin.

const api = createStaffApi({ fetch: (input, init) => window.fetch(input, init), cookie: () => document.cookie });
const store = createConsoleStore({ api, history: window.history, clock: systemClock, path: window.location.pathname });
window.addEventListener("popstate", () => store.popped(window.location.pathname));

const container = document.getElementById("root");
if (!container) throw new Error("the console's page has no #root element");
// The Signal API is a static method of PublicKeyCredential where the browser has it; the enrolment page checks for it.
const signal = (window as unknown as { PublicKeyCredential?: SignalApi }).PublicKeyCredential;
createRoot(container).render(<App store={store} credentials={navigator.credentials} signal={signal} />);
void store.start();
```

### Create `apps/admin/src/messages.ts`

```ts
import type { StaffErrorCode } from "@korbat/contracts";

/**
 * The console's own words for every code it can receive (3a design, section 10). The server's message is never shown:
 * the console words each code from this table, so a changed or hostile API answer cannot put its own text on the page,
 * and no staff screen ever shows the text of a passkey code, whose remedies are the app's.
 */

/** The ten staff codes, in the design's words. */
export const STAFF_MESSAGES: Record<StaffErrorCode, string> = {
  staff_session_required: "Your staff session ended. Sign in with your staff key.",
  staff_key_invalid: "This key does not open the staff console. If it should, ask the operator to check your staff keys.",
  staff_key_suspended: "This staff key was switched off because a copy of it may exist. Ask the operator for a link to enrol a new one.",
  staff_key_limit: "This account has 5 staff keys. Ask the operator to revoke one before enrolling another.",
  staff_key_not_device_bound: "This key can be synced or copied, so it cannot be a staff key. Use a security key or a device-bound authenticator.",
  staff_key_not_user_verified: "This key did not ask for a PIN or fingerprint, so it cannot be a staff key. Set a PIN on it, or use another key.",
  staff_key_refused: "The browser's answer for this key could not be checked. Try again, or use another key; this link still works.",
  staff_enrollment_invalid: "This enrolment link has expired or was already used. Ask the operator for a new one.",
  staff_step_up_required: "Confirm this with your staff key.",
  staff_step_up_invalid: "That confirmation was for another action, was already used or could not be checked. Try again.",
};

/**
 * The shared codes a staff route may also answer, and the console's own: a network failure, an answer its schemas refuse,
 * a browser prompt that did not finish, and step-up options that bind something other than the action the person chose.
 */
const OTHER_MESSAGES: Record<string, string> = {
  challenge_expired: "That took too long. Try again.",
  rate_limited: "Too many attempts. Wait a while, then try again.",
  invalid_request: "Some details are missing or invalid.",
  not_found: "That no longer exists.",
  csrf_failed: "This request could not be verified. Reload the page and try again.",
  internal: "Something went wrong on the server. Try again.",
  network: "The staff console's server cannot be reached. Check your connection and try again.",
  invalid_answer: "The server's answer could not be read. Reload the page and try again.",
  ceremony_cancelled: "Nothing was signed: the browser's prompt was closed or timed out. Try again.",
  key_already_registered: "This key is already registered for your staff account. Use another key.",
  ceremony_refused: "The browser refused to use a key here. Open the console at exactly the address in CONSOLE_ORIGIN, never at 127.0.0.1, and try again.",
  step_up_mismatch:
    "The confirmation could not be checked: the server asked your key to sign something other than this action, so your key was not asked. Reload the page and try again; if it happens again, tell the operator.",
};

const FALLBACK = "Something went wrong. Try again.";

/** The console's words for a code; a code it does not know, a passkey code included, gets the plain fallback. */
export function messageFor(code: string): string {
  if (Object.hasOwn(STAFF_MESSAGES, code)) return STAFF_MESSAGES[code as StaffErrorCode];
  if (Object.hasOwn(OTHER_MESSAGES, code)) return OTHER_MESSAGES[code]!;
  return FALLBACK;
}

/** The words for anything a screen's action threw: the console's errors carry a code, anything else is the fallback. */
export function describeError(err: unknown): string {
  if (err instanceof Error && "code" in err && typeof err.code === "string") return messageFor(err.code);
  return FALLBACK;
}
```

### Create `apps/admin/src/nav.tsx`

```tsx
import type { MouseEvent, ReactNode } from "react";
import type { ConsolePath } from "./router";

/**
 * A link to one of the console's own pages. Its address is one of the constants ConsolePath lists, never built from
 * data; a plain click moves inside the page through the store, any other click (a new tab, a new window) is the
 * browser's, as on any link.
 */
export function NavLink({ to, current = false, onNavigate, children }: { to: ConsolePath; current?: boolean; onNavigate(path: ConsolePath): void; children: ReactNode }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };
  return (
    <a href={to} aria-current={current ? "page" : undefined} onClick={follow}>
      {children}
    </a>
  );
}
```

### Create `apps/admin/src/react-dom.d.ts`

```ts
// react-dom ships no types and @types/react-dom is not installed (the app's tests declare react-dom/server the same way);
// the console uses only these two functions.
declare module "react-dom/client" {
  import type { ReactNode } from "react";
  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}

declare module "react-dom/server" {
  import type { ReactNode } from "react";
  export function renderToStaticMarkup(node: ReactNode): string;
}
```

### Create `apps/admin/src/router.ts`

```ts
/**
 * The console's own router (3a design, section 9): four paths and nothing else. The address bar is the only state it
 * reads; the store pushes and replaces history entries itself, so the page needs no routing library.
 */

/** The pages the console links to. A link is only ever one of these constants, never an address built from data. */
export type ConsolePath = "/" | "/audit" | "/signin";

export type Route = { name: "home" } | { name: "audit" } | { name: "signin" } | { name: "enroll"; token: string } | { name: "unknown" };

/**
 * The route an address names. A trailing slash names the same page. An enrolment link's token is kept exactly as written:
 * the enrolment page checks its shape before it sends it anywhere.
 */
export function parseRoute(pathname: string): Route {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (path === "/") return { name: "home" };
  if (path === "/audit") return { name: "audit" };
  if (path === "/signin") return { name: "signin" };
  const enroll = /^\/enroll\/([^/]+)$/.exec(path);
  if (enroll) return { name: "enroll", token: enroll[1]! };
  return { name: "unknown" };
}
```

### Create `apps/admin/src/screens/Audit.tsx`

```tsx
import type { AuditEntry, AuditPage } from "@korbat/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { createAuditReader, parsePlace } from "../audit-log";
import { describeError } from "../messages";
import { dateTimeSeconds, Loaded, UserText, type Loadable } from "../ui";

/**
 * The audit log (3a design, sections 2 and 9): a table, newest first, "Load older", and "Go to place", which opens the
 * page whose newest row is at a place the keeper kept. Until 3d publishes the head, the keeper copies the newest place and
 * hash from here each day and opens the place kept the visit before to check that it still shows the same hash.
 */
export interface AuditViewProps {
  /** Every row read so far, newest first. */
  page: Loadable<AuditEntry[]>;
  hasOlder: boolean;
  loadingOlder: boolean;
  /** The place the page was opened at with Go to place, or null for the newest rows. */
  at: number | null;
  place: string;
  placeError: string | null;
  error: string | null;
  onLoadOlder(): void;
  onPlace(text: string): void;
  onGoToPlace(): void;
  onNewest(): void;
}

const PLACE_RULE = "Enter a place: a whole number from 1.";

export function AuditView({ page, hasOlder, loadingOlder, at, place, placeError, error, onLoadOlder, onPlace, onGoToPlace, onNewest }: AuditViewProps) {
  return (
    <section aria-labelledby="audit-title">
      <h2 id="audit-title">Audit log</h2>
      <p className="hint">
        Every staff action, newest first. Each row's hash covers every row before it, so a row changed later changes every hash after it. Each day the
        keeper copies the newest place and hash, and opens the place kept on the previous visit with Go to place to check that it still shows the same hash.
      </p>

      <form
        className="place"
        onSubmit={(event) => {
          event.preventDefault();
          onGoToPlace();
        }}
      >
        <label htmlFor="place">Place</label>
        <input
          id="place"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={place}
          aria-invalid={placeError !== null}
          aria-describedby={placeError ? "place-error" : undefined}
          onChange={(event) => onPlace(event.target.value)}
        />
        <button type="submit">Go to place</button>
        {at !== null ? (
          <button type="button" onClick={onNewest}>
            Newest
          </button>
        ) : null}
      </form>
      {placeError ? (
        <p id="place-error" className="error">
          {placeError}
        </p>
      ) : null}
      {at !== null ? <p className="quiet">{`From place ${at}, newest first.`}</p> : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      <Loaded
        value={page}
        render={(entries) =>
          entries.length === 0 ? (
            <p>The audit log holds no rows.</p>
          ) : (
            <div className="scroll">
              <table className="audit">
                <caption className="visually-hidden">The audit log, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Place</th>
                    <th scope="col">Time</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Target</th>
                    <th scope="col">Confirmed action</th>
                    <th scope="col">Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.seq}>
                      <td>{entry.seq}</td>
                      <td>
                        <time dateTime={entry.createdAt}>{dateTimeSeconds(entry.createdAt)}</time>
                      </td>
                      <td>{entry.actorHandle === null ? "no handle" : <UserText>{entry.actorHandle}</UserText>}</td>
                      <td>
                        <code>{entry.action}</code>
                      </td>
                      <td>
                        {entry.targetType === null ? null : (
                          <>
                            <code>{entry.targetType}</code> <UserText>{entry.targetId ?? ""}</UserText>
                          </>
                        )}
                      </td>
                      <td>{entry.actionHash === null ? null : <code className="hash">{entry.actionHash}</code>}</td>
                      <td>
                        <code className="hash">{entry.hash}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      />
      {hasOlder ? (
        <button type="button" onClick={onLoadOlder} disabled={loadingOlder} aria-busy={loadingOlder}>
          Load older
        </button>
      ) : null}
    </section>
  );
}

export function Audit({ api }: { api: StaffApi }) {
  const reader = useMemo(() => createAuditReader(api), [api]);
  const [page, setPage] = useState<Loadable<AuditEntry[]>>({ state: "loading" });
  const [cursor, setCursor] = useState<number | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [place, setPlace] = useState("");
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  /** Shows one page from its start: the newest rows, or those from a place. */
  const open = async (read: () => Promise<AuditPage>, opened: number | null) => {
    setPage({ state: "loading" });
    setError(null);
    try {
      const answer = await read();
      if (!alive.current) return;
      setPage({ state: "ready", value: answer.entries });
      setCursor(answer.nextCursor);
      setAt(opened);
    } catch (err) {
      if (alive.current) setPage({ state: "failed", message: describeError(err) });
    }
  };

  useEffect(() => {
    alive.current = true;
    void open(reader.newest, null);
    return () => {
      alive.current = false;
    };
  }, [reader]);

  const loadOlder = async () => {
    if (cursor === null) return;
    setLoadingOlder(true);
    setError(null);
    try {
      const answer = await reader.older(cursor);
      if (!alive.current) return;
      setPage((current) => ({ state: "ready", value: [...(current.state === "ready" ? current.value : []), ...answer.entries] }));
      setCursor(answer.nextCursor);
    } catch (err) {
      if (alive.current) setError(describeError(err));
    } finally {
      if (alive.current) setLoadingOlder(false);
    }
  };

  const goToPlace = () => {
    const target = parsePlace(place);
    if (target === null) {
      setPlaceError(PLACE_RULE);
      return;
    }
    setPlaceError(null);
    void open(() => reader.at(target), target);
  };

  return (
    <AuditView
      page={page}
      hasOlder={cursor !== null}
      loadingOlder={loadingOlder}
      at={at}
      place={place}
      placeError={placeError}
      error={error}
      onLoadOlder={() => void loadOlder()}
      onPlace={setPlace}
      onGoToPlace={goToPlace}
      onNewest={() => void open(reader.newest, null)}
    />
  );
}
```

### Create `apps/admin/src/screens/Enroll.tsx`

```tsx
import { OpaqueId, StaffKeyName, type StaffKeyKind } from "@korbat/contracts";
import { useState } from "react";
import type { StaffApi } from "../api";
import { enrollKey, type EnrollResult, type SignalApi } from "../enroll";
import { messageFor } from "../messages";
import { UserText } from "../ui";
import type { CredentialsLike } from "../webauthn";

/**
 * The enrolment page (3a design, section 9), opened from the one-time link `staff.js enroll` printed. Before the ceremony
 * it says which keys work and which are refused, how to set a PIN, and that the key will show its name; it offers two
 * buttons, because the security-key hint hides Windows Hello. Each refusal is explained in words, and the page says the
 * link still works.
 */

/** What each refusal of a key means, in the person's terms, beside the console's message for its code. */
const EXPLANATIONS: Record<string, string> = {
  staff_key_not_device_bound: "The browser saved a synced passkey, from a password manager, instead of using a security key or Windows Hello.",
  staff_key_not_user_verified: "The key asked for no PIN or fingerprint.",
  staff_key_refused: "The browser's answer could not be checked.",
};

/** Refusals after which the link enrols nothing more: it is spent or expired, or the account has its five keys. */
const DEAD = new Set(["staff_enrollment_invalid", "staff_key_limit"]);

const NAME_RULE = "Give the key a name of 1 to 50 characters, without invisible characters.";

export interface EnrollViewProps {
  /** Whether the link's token has the shape of one: a malformed link asks nothing of the API. */
  tokenValid: boolean;
  name: string;
  nameError: string | null;
  /** The button whose ceremony is under way. */
  busy: StaffKeyKind | null;
  result: EnrollResult | null;
  onName(name: string): void;
  onRegister(kind: StaffKeyKind): void;
}

function Refusal({ result }: { result: Extract<EnrollResult, { ok: false }> }) {
  const explanation = EXPLANATIONS[result.code];
  return (
    <div role="alert" className="error">
      <p>{messageFor(result.code)}</p>
      {explanation ? <p>{explanation}</p> : null}
      <p>This link still works: you can try again, with this key once it is fixed or with another one, until the link expires.</p>
      {result.cleanup === "signalled" ? <p>The browser was asked to remove the refused passkey from your password manager.</p> : null}
      {result.cleanup === "by-hand" ? <p>Delete the refused entry for the staff console from your password manager by hand, so it is not offered again.</p> : null}
    </div>
  );
}

export function EnrollView({ tokenValid, name, nameError, busy, result, onName, onRegister }: EnrollViewProps) {
  const heading = <h2 id="enroll-title">Register a staff key</h2>;

  if (!tokenValid || (result && !result.ok && DEAD.has(result.code))) {
    return (
      <section className="panel" aria-labelledby="enroll-title">
        {heading}
        <p role="alert" className="error">
          {messageFor(tokenValid && result && !result.ok ? result.code : "staff_enrollment_invalid")}
        </p>
      </section>
    );
  }

  if (result?.ok) {
    return (
      <section className="panel" aria-labelledby="enroll-title">
        {heading}
        <p role="status">
          The staff key <UserText>{result.key.name}</UserText> is registered.
        </p>
        <p>Sign in with it once now, so you know that it opens the console. If it does not, tell the operator at once.</p>
        <p>
          <a href="/signin">Sign in</a>
        </p>
      </section>
    );
  }

  const describedBy = nameError ? "key-name-hint key-name-error" : "key-name-hint";
  return (
    <section className="panel" aria-labelledby="enroll-title">
      {heading}
      <p>This link registers one staff key for your staff account. Staff keys are the only way into the staff console.</p>

      <h3>Keys that work</h3>
      <ul>
        <li>A security key with a PIN: a FIDO2 key that you plug in or hold against the device.</li>
        <li>Windows Hello on this computer.</li>
      </ul>

      <h3>Keys that are refused</h3>
      <p>
        Passkeys saved by a password manager, such as iCloud Keychain or Google Password Manager, and a phone's own passkeys. They are synced or can be
        copied, so they cannot be staff keys. A phone's browser can still use a security key.
      </p>

      <h3>A new security key</h3>
      <p>
        A security key needs a PIN. If the browser does not offer to set one, set a PIN first: in Chrome or Edge under Settings, Privacy and security,
        Security, Manage security keys; on Windows under Settings, Accounts, Sign-in options, Security key; or with the app of the key's maker.
      </p>

      <label htmlFor="key-name">Name of this key</label>
      <p id="key-name-hint" className="hint">
        The key and the console will show this name, so use one that tells your keys apart, such as Blue key: not your email address or your real name.
      </p>
      <input
        id="key-name"
        type="text"
        value={name}
        maxLength={50}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={nameError !== null}
        aria-describedby={describedBy}
        onChange={(event) => onName(event.target.value)}
      />
      {nameError ? (
        <p id="key-name-error" className="error">
          {nameError}
        </p>
      ) : null}

      <div className="actions">
        <button type="button" className="primary" onClick={() => onRegister("security_key")} disabled={busy !== null} aria-busy={busy === "security_key"}>
          Register a security key
        </button>
        <button type="button" onClick={() => onRegister("this_device")} disabled={busy !== null} aria-busy={busy === "this_device"}>
          Use Windows Hello on this computer
        </button>
      </div>
      <p className="hint">For Windows Hello, choose Windows Hello or this device in the browser's dialog, not a password manager.</p>

      {result && !result.ok ? <Refusal result={result} /> : null}
    </section>
  );
}

export function Enroll({
  token,
  api,
  credentials,
  signal,
  onUnavailable,
}: {
  token: string;
  api: StaffApi;
  credentials: CredentialsLike;
  signal: SignalApi | undefined;
  onUnavailable(): void;
}) {
  const tokenValid = OpaqueId.safeParse(token).success;
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState<StaffKeyKind | null>(null);
  const [result, setResult] = useState<EnrollResult | null>(null);

  const register = async (kind: StaffKeyKind) => {
    // The name is checked by the contracts' own rule before anything is asked of the API or the browser.
    const parsed = StaffKeyName.safeParse(name);
    if (!parsed.success) {
      setNameError(NAME_RULE);
      return;
    }
    setNameError(null);
    setResult(null);
    setBusy(kind);
    const outcome = await enrollKey({ api, credentials, signal }, { token, name: parsed.data, kind });
    setBusy(null);
    // The staff routes are not there: the console is off, or this is not its address.
    if (!outcome.ok && outcome.status === 404) return onUnavailable();
    setResult(outcome);
  };

  return <EnrollView tokenValid={tokenValid} name={name} nameError={nameError} busy={busy} result={result} onName={setName} onRegister={(kind) => void register(kind)} />;
}
```

### Create `apps/admin/src/screens/Home.tsx`

```tsx
import type { AuditEntry, StaffKey, StaffMe, StaffSession } from "@korbat/contracts";
import { useEffect, useRef, useState } from "react";
import type { StaffApi } from "../api";
import { describeError } from "../messages";
import { readSignInsAtOpening } from "../signins";
import { revokeSessionWithKey } from "../step-up";
import { clockTime, dateTime, Loaded, UserText, type Loadable } from "../ui";
import type { CredentialsLike } from "../webauthn";

/**
 * The home screen (3a design, section 9): who is signed in and with which role, the session's absolute end, every staff
 * account's sign-ins of the last 7 days, the person's own staff sessions with "Sign out that session" confirmed by the
 * key, and the person's keys. Keys are added and revoked only with the command line, so no button here touches them.
 */
export interface HomeViewProps {
  me: StaffMe;
  signIns: Loadable<AuditEntry[]>;
  sessions: Loadable<StaffSession[]>;
  keys: Loadable<StaffKey[]>;
  /** The handle of the session whose revocation is under way. */
  revoking: string | null;
  notice: string | null;
  error: string | null;
  onRevoke(handle: string): void;
}

export function HomeView({ me, signIns, sessions, keys, revoking, notice, error, onRevoke }: HomeViewProps) {
  return (
    <section aria-labelledby="home-title">
      <h2 id="home-title">Home</h2>
      <p>
        Signed in as <UserText>{me.handle}</UserText>, {me.role}.
      </p>
      <p>{`Signed in until ${clockTime(me.absoluteExpiresAt)}.`}</p>
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      <h3>Staff sign-ins in the last 7 days</h3>
      <p className="hint">Every staff account's, newest first. A sign-in nobody recognises means someone else holds a staff key: tell the operator.</p>
      <Loaded
        value={signIns}
        render={(list) =>
          list.length === 0 ? (
            <p>No staff sign-ins in the last 7 days.</p>
          ) : (
            <ul className="signins">
              {list.map((entry) => (
                <li key={entry.seq}>
                  <time dateTime={entry.createdAt}>{dateTime(entry.createdAt)}</time> <UserText>{entry.actorHandle ?? "no handle"}</UserText>
                </li>
              ))}
            </ul>
          )
        }
      />

      <h3>Your staff sessions</h3>
      <p className="hint">Signing out another session asks your staff key to confirm it.</p>
      <Loaded
        value={sessions}
        render={(list) => (
          <table>
            <caption className="visually-hidden">Your staff sessions</caption>
            <thead>
              <tr>
                <th scope="col">Browser</th>
                <th scope="col">Started</th>
                <th scope="col">Last used</th>
                <th scope="col">
                  <span className="visually-hidden">Sign out</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((session) => (
                <tr key={session.handle}>
                  <td>
                    <UserText>{session.browser}</UserText>
                  </td>
                  <td>{dateTime(session.createdAt)}</td>
                  <td>{dateTime(session.lastUsedAt)}</td>
                  <td>
                    {session.current ? (
                      "This session"
                    ) : (
                      <button type="button" onClick={() => onRevoke(session.handle)} disabled={revoking !== null} aria-busy={revoking === session.handle}>
                        Sign out that session
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      />

      <h3>Your staff keys</h3>
      <p className="hint">The operator adds and revokes staff keys with the staff command line.</p>
      <Loaded
        value={keys}
        render={(list) => (
          <ul className="keys">
            {list.map((key) => (
              <li key={key.id}>
                <UserText>{key.name}</UserText>
                {`: added ${dateTime(key.createdAt)}, ${key.lastUsedAt === null ? "never used" : `last used ${dateTime(key.lastUsedAt)}`}`}
              </li>
            ))}
          </ul>
        )}
      />

      <p className="later">Cases arrive in sub-project 3c.</p>
    </section>
  );
}

/** Runs one read and hands its outcome to `set`, unless the screen has gone meanwhile. */
function load<T>(alive: { current: boolean }, set: (value: Loadable<T>) => void, read: () => Promise<T>): void {
  read().then(
    (value) => alive.current && set({ state: "ready", value }),
    (err: unknown) => alive.current && set({ state: "failed", message: describeError(err) }),
  );
}

/** The person's staff sessions, marked: the screen reads them when it opens and after a revocation the person asked for. */
function readSessions(api: StaffApi, alive: { current: boolean }, set: (value: Loadable<StaffSession[]>) => void): void {
  load(alive, set, async () => (await api.sessions({ activity: true })).sessions);
}

/** Where the screen's three lists go as each read finishes. */
export interface HomeLists {
  signIns(value: Loadable<AuditEntry[]>): void;
  sessions(value: Loadable<StaffSession[]>): void;
  keys(value: Loadable<StaffKey[]>): void;
}

/**
 * What the screen reads when it opens, every read marked, since opening the screen is its person's action. It takes no
 * session: the sign-ins' 7 days are counted from a /me read now (readSignInsAtOpening), never from the session the page
 * holds, which can be hours old.
 */
export function openHome(api: StaffApi, alive: { current: boolean }, set: HomeLists): void {
  load(alive, set.signIns, () => readSignInsAtOpening(api));
  readSessions(api, alive, set.sessions);
  load(alive, set.keys, async () => (await api.keys({ activity: true })).keys);
}

export function Home({ me, api, credentials }: { me: StaffMe; api: StaffApi; credentials: CredentialsLike }) {
  const [signIns, setSignIns] = useState<Loadable<AuditEntry[]>>({ state: "loading" });
  const [sessions, setSessions] = useState<Loadable<StaffSession[]>>({ state: "loading" });
  const [keys, setKeys] = useState<Loadable<StaffKey[]>>({ state: "loading" });
  const [revoking, setRevoking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    openHome(api, alive, { signIns: setSignIns, sessions: setSessions, keys: setKeys });
    return () => {
      alive.current = false;
    };
    // Read once per opening of the screen, never again when the idle timer's reads change `me`; the API client never
    // changes while the page lives.
  }, [api]);

  const revoke = async (handle: string) => {
    setRevoking(handle);
    setNotice(null);
    setError(null);
    try {
      const outcome = await revokeSessionWithKey({ api, credentials }, me.sessionHandle, handle);
      if (!alive.current) return;
      setNotice(outcome === "revoked" ? "That session is signed out." : "That session had already ended.");
      readSessions(api, alive, setSessions);
    } catch (err) {
      if (alive.current) setError(describeError(err));
    } finally {
      if (alive.current) setRevoking(null);
    }
  };

  return <HomeView me={me} signIns={signIns} sessions={sessions} keys={keys} revoking={revoking} notice={notice} error={error} onRevoke={(handle) => void revoke(handle)} />;
}
```

### Create `apps/admin/src/screens/SignIn.tsx`

```tsx
import type { StaffMe } from "@korbat/contracts";
import { useState } from "react";
import { ApiError, type StaffApi } from "../api";
import { describeError } from "../messages";
import { authenticationResponseToJSON, ceremonyFailure, requestOptionsFromJSON, type CredentialsLike } from "../webauthn";

/**
 * Sign-in (3a design, section 9): "Sign in with your staff key", the browser's prompt, and errors in the console's words.
 * The options name no key (a staff key is discoverable), so a failure says to choose the security key or Windows Hello
 * rather than a password manager's passkey. Sign-in never calls the Signal API: every failure before the signature gets
 * one answer, so the page cannot know which credential was refused.
 */
export function SignInView({ ended, busy, error, onSignIn }: { ended: boolean; busy: boolean; error: string | null; onSignIn(): void }) {
  return (
    <section className="panel" aria-labelledby="signin-title">
      <h2 id="signin-title">Sign in</h2>
      {ended ? <p className="ended">Your staff session ended.</p> : null}
      <p>Use your staff key: your security key, or Windows Hello on the computer where you registered it. The browser asks for its PIN or your fingerprint.</p>
      <button type="button" className="primary" onClick={onSignIn} disabled={busy} aria-busy={busy}>
        Sign in with your staff key
      </button>
      {error ? (
        <div role="alert" className="error">
          <p>{error}</p>
          <p>In the browser's dialog, choose your security key or Windows Hello, not a passkey saved in a password manager: those cannot be staff keys.</p>
        </div>
      ) : null}
    </section>
  );
}

export function SignIn({
  ended,
  api,
  credentials,
  onSignedIn,
  onUnavailable,
}: {
  ended: boolean;
  api: StaffApi;
  credentials: CredentialsLike;
  onSignedIn(me: StaffMe): void;
  onUnavailable(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      // The person pressed the button: both requests are marked, though no session exists yet to move.
      const { options } = await api.signInOptions({ activity: true });
      let credential: unknown;
      try {
        credential = await credentials.get({ publicKey: requestOptionsFromJSON(options) });
      } catch (err) {
        throw ceremonyFailure(err);
      }
      const me = await api.signInVerify({ response: authenticationResponseToJSON(credential) }, { activity: true });
      setBusy(false);
      onSignedIn(me);
    } catch (err) {
      setBusy(false);
      // The staff routes are not there: the console is off, or this is not its address.
      if (err instanceof ApiError && err.status === 404) return onUnavailable();
      setError(describeError(err));
    }
  };

  return <SignInView ended={ended} busy={busy} error={error} onSignIn={() => void signIn()} />;
}
```

### Create `apps/admin/src/screens/Unavailable.tsx`

```tsx
/**
 * The page for a console that is off, or opened at another address (3a design, section 9). GET /api/staff/me answers
 * 404 in both cases, since the staff gate answers a wrong Host with the same 404 as a console that is off, so the page
 * cannot tell them apart and says both. It shows only this.
 */
export const UNAVAILABLE_TEXT =
  "The staff console is not available at this address. It is off on this server, or this is not the address set in CONSOLE_ORIGIN: open it at exactly that address, never at 127.0.0.1.";

export function Unavailable() {
  return (
    <main className="unavailable">
      <p>{UNAVAILABLE_TEXT}</p>
    </main>
  );
}
```

### Create `apps/admin/src/signins.ts`

```ts
import type { AuditEntry, AuditPage, StaffMe } from "@korbat/contracts";
import type { StaffApi } from "./api";

/**
 * The home screen's list of every staff account's sign-ins in the last 7 days (3a design, section 9): the audit reader's
 * staff_sign_in filter, read page by page, newest first, until a sign-in older than 7 days.
 */
export const SIGN_IN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The server's time when it answered /me: the session's absolute end less the seconds it said were left. The console
 * keeps no clock of its own, so a browser whose clock is wrong still lists the right week.
 */
export function serverNow(me: StaffMe): number {
  return Date.parse(me.absoluteExpiresAt) - me.absoluteSecondsLeft * 1000;
}

/**
 * Reads pages through `readPage` (the cursor of the page before, or undefined for the newest) until one holds a sign-in
 * older than `since`, or there is no older page. A cursor that does not move back ends the reading, so an answer that
 * repeats itself cannot keep the page asking.
 */
export async function readRecentSignIns(readPage: (cursor: number | undefined) => Promise<AuditPage>, since: number): Promise<AuditEntry[]> {
  const list: AuditEntry[] = [];
  let cursor: number | undefined;
  for (;;) {
    const page = await readPage(cursor);
    for (const entry of page.entries) {
      if (Date.parse(entry.createdAt) < since) return list;
      if (entry.action === "staff_sign_in") list.push(entry);
    }
    if (page.nextCursor === null || (cursor !== undefined && page.nextCursor >= cursor)) return list;
    cursor = page.nextCursor;
  }
}

/**
 * The list as the home screen reads it when it opens: first the server's time, from a GET /api/staff/me of its own, then
 * the pages back to 7 days before that time. The session the page already holds will not do: it was read at sign-in, at
 * the page's opening or by the idle timer, whose read a person who keeps acting pushes away for hours. Every request is
 * marked, since opening the screen is its person's action.
 */
export async function readSignInsAtOpening(api: Pick<StaffApi, "me" | "audit">): Promise<AuditEntry[]> {
  const now = serverNow(await api.me({ activity: true }));
  return readRecentSignIns((cursor) => api.audit({ action: "staff_sign_in", cursor }, { activity: true }), now - SIGN_IN_WINDOW_MS);
}
```

### Create `apps/admin/src/step-up.ts`

```ts
import { STAFF_STEP_UP_CHALLENGE, StaffStepUpOptionsRequest, stepUpActionHash, stepUpBinding } from "@korbat/contracts";
import { ApiError, type StaffApi } from "./api";
import { messageFor } from "./messages";
import { authenticationResponseToJSON, ceremonyFailure, fromBase64url, requestOptionsFromJSON, type CredentialsLike } from "./webauthn";

/**
 * The step-up as the console runs it (3a design, sections 7 and 9). Before it asks the key to confirm an action, the page
 * checks the options the API gave it: the challenge must be the 74 bytes of the contracts' step-up layout with the
 * staff_step_up purpose, bound to the sha256 of this session's handle and the hash of exactly the `{ action, target,
 * params }` the page chose, and the allow list must hold one key. Otherwise the key is never asked, so an API under an
 * attacker's control cannot have it sign an action the person did not choose. The check trusts the page, which Caddy
 * serves from its image, not the API.
 */

/** Options that bind something other than the action the person chose; the key was not asked. */
export class StepUpMismatch extends Error {
  readonly code = "step_up_mismatch";
  readonly status = 0;
  constructor() {
    super(messageFor("step_up_mismatch"));
    this.name = "StepUpMismatch";
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * Checks step-up options against this session's handle and the action the page is about to confirm, with the contracts'
 * layout, purpose code, sorted-JSON text and hash, never a copy of them. Throws StepUpMismatch on any difference.
 */
export async function checkStepUpOptions(options: { challenge: string; allowCredentials?: unknown }, sessionHandle: string, action: StaffStepUpOptionsRequest): Promise<void> {
  const layout = STAFF_STEP_UP_CHALLENGE;
  let challenge: Uint8Array;
  try {
    challenge = fromBase64url(options.challenge);
  } catch {
    throw new StepUpMismatch();
  }
  if (challenge.length !== layout.bytes) throw new StepUpMismatch();
  if (challenge[layout.versionAt] !== layout.version || challenge[layout.purposeAt] !== layout.purpose) throw new StepUpMismatch();
  // The binding is recomputed here from what the page chose, so a challenge bound to another action, target, params or
  // session never reaches the key.
  const expected = await stepUpBinding(sessionHandle, await stepUpActionHash(action));
  if (!sameBytes(challenge.subarray(layout.bindingAt, layout.bindingAt + layout.bindingBytes), expected)) throw new StepUpMismatch();
  // Exactly one key, the session's own: an empty list would let the browser offer any key the person holds.
  if (!Array.isArray(options.allowCredentials) || options.allowCredentials.length !== 1) throw new StepUpMismatch();
}

/**
 * The action that revokes one of the person's staff sessions: its handle as the target, in lower case, the one spelling
 * the API accepts for a step-up target (it hashes the id exactly as sent), and no params.
 */
export function sessionRevokeAction(handle: string): StaffStepUpOptionsRequest {
  return StaffStepUpOptionsRequest.parse({ action: "staff_session_revoked", target: { type: "staff_session", id: handle.toLowerCase() }, params: {} });
}

/**
 * "Sign out that session", confirmed by the key: options for exactly this action, asked right before the key (the API
 * reads a step-up challenge only while more than a minute of its ten is left), checked, signed, then sent with the
 * revocation. "gone" when the session had already ended. Every request is marked: the person clicked.
 */
export async function revokeSessionWithKey(deps: { api: StaffApi; credentials: CredentialsLike }, sessionHandle: string, targetHandle: string): Promise<"revoked" | "gone"> {
  const action = sessionRevokeAction(targetHandle);
  const { options } = await deps.api.stepUpOptions(action, { activity: true });
  await checkStepUpOptions(options, sessionHandle, action);
  let credential: unknown;
  try {
    credential = await deps.credentials.get({ publicKey: requestOptionsFromJSON(options) });
  } catch (err) {
    throw ceremonyFailure(err);
  }
  const stepUp = authenticationResponseToJSON(credential);
  try {
    await deps.api.revokeSession(action.target.id, { stepUp }, { activity: true });
    return "revoked";
  } catch (err) {
    // The API answers a handle that names no live session of the person's as the app does: 404.
    if (err instanceof ApiError && err.status === 404 && err.code === "not_found") return "gone";
    throw err;
  }
}
```

### Create `apps/admin/src/store.ts`

```ts
import type { StaffMe } from "@korbat/contracts";
import { ApiError, type StaffApi } from "./api";
import { createIdleTimer, type Clock, type IdleWarning } from "./idle";
import { messageFor } from "./messages";
import { parseRoute, type ConsolePath, type Route } from "./router";

/**
 * The console's state across its screens (3a design, section 9): the address, the session the page holds, and the idle
 * timer's warning. Screens read it through React's useSyncExternalStore and keep their own lists to themselves.
 *
 * Any staff_session_required answer, from any request, the idle timer's reads included, means the API has already
 * cleared both staff cookies: the page then shows sign-in in place, keeping the address, and after the sign-in it shows
 * that address's page again. A GET /api/staff/me that answers 404 means the console is off on this server or was opened
 * at an address other than CONSOLE_ORIGIN (the staff gate answers both the same), and the page says only that.
 */
export type Session =
  | { kind: "checking" }
  | { kind: "signed-in"; me: StaffMe }
  /** Sign-in shows; `ended` when a staff_session_required answer told of a session that ended, which the page says. */
  | { kind: "signed-out"; ended: boolean }
  | { kind: "unavailable" }
  | { kind: "failed"; message: string };

export interface ConsoleState {
  path: string;
  route: Route;
  session: Session;
  warning: IdleWarning | null;
}

/** The part of window.history the store writes. */
export interface HistoryLike {
  pushState(data: unknown, unused: string, url: string): void;
  replaceState(data: unknown, unused: string, url: string): void;
}

export interface ConsoleStoreDeps {
  api: StaffApi;
  history: HistoryLike;
  clock: Clock;
  /** The address the page opened at. */
  path: string;
}

export type ConsoleStore = ReturnType<typeof createConsoleStore>;

export function createConsoleStore(deps: ConsoleStoreDeps) {
  const { api } = deps;
  let state: ConsoleState = { path: deps.path, route: parseRoute(deps.path), session: { kind: "checking" }, warning: null };
  const listeners = new Set<() => void>();

  const set = (next: Partial<ConsoleState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const idle = createIdleTimer({
    clock: deps.clock,
    // The timer's reads carry no mark: they are the page's own, never its person's.
    readMe: () => api.me({ activity: false }),
    onWarning: (warning) => set({ warning }),
    onMe: (me) => {
      if (state.session.kind === "signed-in") set({ session: { kind: "signed-in", me } });
    },
  });

  const go = (path: ConsolePath, how: "push" | "replace") => {
    if (how === "push") deps.history.pushState(null, "", path);
    else deps.history.replaceState(null, "", path);
    set({ path, route: parseRoute(path) });
  };

  const sessionEnded = (carriedStaffCookie: boolean) => {
    // The page says the session ended when it held one, or when the refused request carried the staff CSRF cookie, which
    // only a sign-in sets: a reload or a new tab after an idle-out. Without either, there was no session to end (never
    // signed in, signed out, or the cookie's 12 hours over), and the page shows plain sign-in.
    const ended = state.session.kind === "signed-in" || carriedStaffCookie || (state.session.kind === "signed-out" && state.session.ended);
    idle.stop();
    set({ session: { kind: "signed-out", ended }, warning: null });
  };

  api.hooks.onSessionRequired = sessionEnded;
  api.hooks.onActivity = () => {
    if (state.session.kind === "signed-in") idle.restart();
  };

  const signedIn = (me: StaffMe) => {
    set({ session: { kind: "signed-in", me }, warning: null });
    idle.start(me);
    // Sign-in in place keeps the address; only the sign-in page and an enrolment link move on, to the home page.
    if (state.route.name === "signin" || state.route.name === "enroll") go("/", "replace");
  };

  const unavailable = () => {
    idle.stop();
    set({ session: { kind: "unavailable" }, warning: null });
  };

  return {
    api,
    get: (): ConsoleState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Opens the page: an enrolment link needs no session and reads none; every other page reads /me, marked, since
     * opening a page is its person's action.
     */
    async start(): Promise<void> {
      if (state.route.name === "enroll") {
        set({ session: { kind: "signed-out", ended: false } });
        return;
      }
      set({ session: { kind: "checking" } });
      try {
        signedIn(await api.me({ activity: true }));
      } catch (err) {
        if (err instanceof ApiError && err.code === "staff_session_required") return; // the hook showed sign-in
        if (err instanceof ApiError && err.status === 404) return unavailable();
        set({ session: { kind: "failed", message: err instanceof ApiError ? err.message : messageFor("internal") } });
      }
    },

    /** A link inside the console: a new history entry, and the page for it. */
    navigate: (path: ConsolePath) => go(path, "push"),

    /** The browser went back or forward. Back to the sign-in page with a live session is home. */
    popped(path: string) {
      set({ path, route: parseRoute(path) });
      if (state.session.kind === "signed-in" && state.route.name === "signin") go("/", "replace");
    },

    signedIn,

    /** The person signed out: the timer stops and the sign-in page shows, at its own address. */
    signedOut() {
      idle.stop();
      set({ session: { kind: "signed-out", ended: false }, warning: null });
      go("/signin", "push");
    },

    unavailable,

    /** "Stay signed in": one marked GET /me. Its success restarts the timer through the activity hook. */
    async stay(): Promise<void> {
      try {
        const me = await api.me({ activity: true });
        if (state.session.kind === "signed-in") set({ session: { kind: "signed-in", me } });
      } catch {
        // A 401 has shown sign-in; anything else leaves the warning up, and the timer's own read decides.
      }
    },

    dispose() {
      idle.stop();
      listeners.clear();
    },
  };
}
```

### Create `apps/admin/src/ui.tsx`

```tsx
import type { ReactNode } from "react";

/**
 * Small pieces every screen uses. A string a person wrote (a handle, a key's name, a browser label) is only ever a text
 * child, which React escapes, inside a <bdi>: a direction override in it then cannot reorder the text around it.
 */
export function UserText({ children }: { children: string }) {
  return <bdi>{children}</bdi>;
}

/** A list a screen reads from the API: still loading, read, or failed with the console's words. */
export type Loadable<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; message: string };

export function Loaded<T>({ value, render }: { value: Loadable<T>; render: (value: T) => ReactNode }) {
  if (value.state === "loading") return <p className="quiet">Loading</p>;
  if (value.state === "failed") return <p className="error">{value.message}</p>;
  return <>{render(value.value)}</>;
}

const two = (n: number): string => String(n).padStart(2, "0");

/** A time of day in the browser's zone, as the design writes it: "21:40". */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** A date and time in the browser's zone: "2026-09-30 21:40". */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${clockTime(iso)}`;
}

/** The same with seconds, for the audit log: "2026-09-30 21:40:05". */
export function dateTimeSeconds(iso: string): string {
  return `${dateTime(iso)}:${two(new Date(iso).getSeconds())}`;
}
```

### Create `apps/admin/src/webauthn.ts`

```ts
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@korbat/contracts";
import { z } from "zod";
import { messageFor } from "./messages";

/**
 * The browser side of the staff ceremonies, without a WebAuthn library: the server library's JSON options become the
 * browser's (their binary members decoded from base64url), and the browser's credential becomes the JSON the contracts
 * describe. Whatever the options say, every ceremony asks for user verification and no attestation, and passes on no
 * extension but credProps: the console asks the key for nothing the design does not need.
 */

/** A ceremony that did not finish or could not be read, with the console's words for why. */
export class CeremonyError extends Error {
  readonly status = 0;
  constructor(readonly code: "ceremony_cancelled" | "key_already_registered" | "ceremony_refused" | "invalid_answer") {
    super(messageFor(code));
    this.name = "CeremonyError";
  }
}

/** The part of navigator.credentials the console calls; a test hands in its own. */
export interface CredentialsLike {
  create(options: { publicKey: PublicKeyCredentialCreationOptions }): Promise<unknown>;
  get(options: { publicKey: PublicKeyCredentialRequestOptions }): Promise<unknown>;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VALUE = new Map([...ALPHABET].map((char, index) => [char, index]));

/** Bytes as unpadded base64url, as the browser library and the server write every binary member. */
export function toBase64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const n = (bytes[i]! << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (b1 !== undefined) out += ALPHABET[(n >> 6) & 63]!;
    if (b2 !== undefined) out += ALPHABET[n & 63]!;
  }
  return out;
}

/** Unpadded base64url as bytes; anything else (padding, + or /, an impossible length) is refused. */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new CeremonyError("invalid_answer");
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (const char of text) {
    // Only the bits not yet written are kept, so the number never outgrows 24 bits.
    buffer = ((buffer << 6) | VALUE.get(char)!) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

const Base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);
const Descriptor = z.object({ id: Base64url, type: z.literal("public-key"), transports: z.array(z.string()).max(8).optional() });

/** The registration options as @simplewebauthn/server writes them; only what the console passes on is read. */
const CreationOptionsJSON = z.object({
  challenge: Base64url,
  rp: z.object({ id: z.string().optional(), name: z.string() }),
  user: z.object({ id: Base64url, name: z.string(), displayName: z.string() }),
  pubKeyCredParams: z.array(z.object({ alg: z.number().int(), type: z.literal("public-key") })).min(1),
  timeout: z.number().int().positive().optional(),
  excludeCredentials: z.array(Descriptor).optional(),
  authenticatorSelection: z
    .object({
      authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
      residentKey: z.enum(["discouraged", "preferred", "required"]).optional(),
      requireResidentKey: z.boolean().optional(),
    })
    .optional(),
  extensions: z.object({ credProps: z.boolean().optional() }).optional(),
  hints: z.array(z.enum(["security-key", "client-device", "hybrid"])).optional(),
});

/** The assertion options as @simplewebauthn/server writes them. */
const RequestOptionsJSON = z.object({
  challenge: Base64url,
  rpId: z.string().optional(),
  timeout: z.number().int().positive().optional(),
  allowCredentials: z.array(Descriptor).optional(),
});

function parseOptions<T>(schema: z.ZodType<T>, json: unknown): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new CeremonyError("invalid_answer");
  return parsed.data;
}

const descriptor = (d: z.infer<typeof Descriptor>): PublicKeyCredentialDescriptor => ({
  id: fromBase64url(d.id),
  type: "public-key",
  ...(d.transports ? { transports: d.transports as AuthenticatorTransport[] } : {}),
});

/** navigator.credentials.create's options from the enrolment's JSON options. */
export function creationOptionsFromJSON(json: unknown): PublicKeyCredentialCreationOptions {
  const o = parseOptions(CreationOptionsJSON, json);
  const options: PublicKeyCredentialCreationOptions & { hints?: string[] } = {
    challenge: fromBase64url(o.challenge),
    rp: o.rp,
    user: { id: fromBase64url(o.user.id), name: o.user.name, displayName: o.user.displayName },
    pubKeyCredParams: o.pubKeyCredParams,
    ...(o.timeout === undefined ? {} : { timeout: o.timeout }),
    excludeCredentials: (o.excludeCredentials ?? []).map(descriptor),
    // A staff key always verifies its user (3a design, section 2), whatever the options said.
    authenticatorSelection: { ...o.authenticatorSelection, userVerification: "required" },
    // The console asks for no attestation, so the key's make and model are never sent.
    attestation: "none",
    ...(o.extensions?.credProps === true ? { extensions: { credProps: true } } : {}),
    // The security-key hint, sent only for the "Register a security key" button; the browser reads it, TypeScript does not know it yet.
    ...(o.hints ? { hints: o.hints } : {}),
  };
  return options;
}

/** navigator.credentials.get's options from a sign-in's or a step-up's JSON options. */
export function requestOptionsFromJSON(json: unknown): PublicKeyCredentialRequestOptions {
  const o = parseOptions(RequestOptionsJSON, json);
  return {
    challenge: fromBase64url(o.challenge),
    ...(o.rpId === undefined ? {} : { rpId: o.rpId }),
    ...(o.timeout === undefined ? {} : { timeout: o.timeout }),
    ...(o.allowCredentials === undefined ? {} : { allowCredentials: o.allowCredentials.map(descriptor) }),
    userVerification: "required",
  };
}

/** An ArrayBuffer or a view of one, as base64url; anything else is not a credential the console can read. */
function encode(value: unknown): string {
  if (value instanceof ArrayBuffer) return toBase64url(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return toBase64url(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  throw new CeremonyError("ceremony_refused");
}

interface CredentialShape {
  id: unknown;
  rawId: unknown;
  type: unknown;
  authenticatorAttachment?: unknown;
  response?: Record<string, unknown>;
  getClientExtensionResults?: () => unknown;
}

/** The members both kinds of credential share; null (a prompt that returned nothing) is a ceremony that did not finish. */
function common(credential: unknown) {
  if (credential === null || credential === undefined) throw new CeremonyError("ceremony_cancelled");
  const c = credential as CredentialShape;
  if (typeof c.id !== "string" || c.type !== "public-key" || typeof c.response !== "object" || c.response === null) throw new CeremonyError("ceremony_refused");
  const extensions = typeof c.getClientExtensionResults === "function" ? c.getClientExtensionResults() : {};
  // Left out when the browser did not say, as the contracts' schema allows; it never sends null.
  const attachment: { authenticatorAttachment?: "platform" | "cross-platform" } =
    c.authenticatorAttachment === "platform" || c.authenticatorAttachment === "cross-platform" ? { authenticatorAttachment: c.authenticatorAttachment } : {};
  return {
    head: { id: c.id, rawId: encode(c.rawId), type: "public-key" as const },
    response: c.response,
    clientExtensionResults: (typeof extensions === "object" && extensions !== null ? extensions : {}) as Record<string, unknown>,
    attachment,
  };
}

/** The browser's new credential as the contracts' RegistrationResponseJSON. */
export function registrationResponseToJSON(credential: unknown): RegistrationResponseJSON {
  const { head, response, clientExtensionResults, attachment } = common(credential);
  if (response.attestationObject === undefined) throw new CeremonyError("ceremony_refused");
  const getTransports = response.getTransports;
  const transports = typeof getTransports === "function" ? (getTransports.call(response) as unknown) : undefined;
  return {
    ...head,
    response: {
      clientDataJSON: encode(response.clientDataJSON),
      attestationObject: encode(response.attestationObject),
      ...(Array.isArray(transports) ? { transports: transports.filter((t): t is string => typeof t === "string").slice(0, 8) } : {}),
    },
    clientExtensionResults,
    ...attachment,
  };
}

/** The browser's assertion as the contracts' AuthenticationResponseJSON. */
export function authenticationResponseToJSON(credential: unknown): AuthenticationResponseJSON {
  const { head, response, clientExtensionResults, attachment } = common(credential);
  if (response.signature === undefined || response.authenticatorData === undefined) throw new CeremonyError("ceremony_refused");
  return {
    ...head,
    response: {
      clientDataJSON: encode(response.clientDataJSON),
      authenticatorData: encode(response.authenticatorData),
      signature: encode(response.signature),
      // A discoverable key returns the account's user handle; the API needs it at sign-in.
      ...(response.userHandle === null || response.userHandle === undefined ? {} : { userHandle: encode(response.userHandle) }),
    },
    clientExtensionResults,
    ...attachment,
  };
}

/** What a browser's refusal means, in the console's words; the browser's own message is never shown. */
export function ceremonyFailure(err: unknown): CeremonyError {
  if (err instanceof CeremonyError) return err;
  const name = err instanceof Error ? err.name : "";
  // The person closed the prompt, it timed out, or the page went away under it.
  if (name === "NotAllowedError" || name === "AbortError") return new CeremonyError("ceremony_cancelled");
  // An excluded credential matched: this key is already one of the account's staff keys (or, in development, a passkey).
  if (name === "InvalidStateError") return new CeremonyError("key_already_registered");
  // SecurityError (the address is not the relying party's, such as 127.0.0.1), NotSupportedError and anything else.
  return new CeremonyError("ceremony_refused");
}
```

### Create `apps/admin/src/zod-jitless.ts`

```ts
import { z } from "zod";

// The page runs under require-trusted-types-for 'script' with trusted-types 'none' (3a design, section 3). Unless zod is
// jitless, the first object schema it builds probes whether it may compile code from a string, which the policy reports
// even though zod catches the failure (console-lab.md, probe zod). The contracts build their schemas as soon as they are imported, so
// this module is the entry's first import and imports nothing but zod.
z.config({ jitless: true });
```

### Create `apps/admin/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2023", "DOM", "DOM.Iterable"], "jsx": "react-jsx", "types": ["node"] },
  "include": ["src", "test", "vitest.config.ts", "*.d.mts"]
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
      - run: pnpm --filter @korbat/api build && pnpm --filter @korbat/worker build && pnpm --filter @korbat/admin build
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
pnpm --filter @korbat/admin dev             # the staff console at http://localhost:8090 (never 127.0.0.1); forwards /api/staff/* to the API above
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

## Explore
A ranked list of recent original posts, the third tab of Home (`/?tab=explore`). Its whole formula is published at `/explore/about`, printed from `EXPLORE_V1` in `packages/contracts/src/explore.ts`, the constant the ranking itself uses; changing any number means a new formula version with a dated entry in its change log.
- **What is ranked.** Visible top-level posts that are not quotes, from the last 48 hours, by live accounts that have not switched Explore off. Replies belong to their threads, and quotes stay out so that a mocking quote cannot put its target's post on a public page.
- **What counts.** Approving accounts: the distinct accounts other than the author that liked or reposted the post, each at least 48 hours old when it did, still live, the like or repost at least 10 minutes old. The score is approving accounts / (hours since posting + 2)^1.8; a post needs at least 3; one account has at most 2 posts in a ranking of 300. Replies, quotes, followers, the badge and reports are never read.
- **The refresh.** The API's `explore-refresh` job ranks at start and every five minutes under the shared job lock, and a round within 4.5 minutes of the last writes nothing, however many instances run. Each ranking is a numbered generation in `explore_runs` and `explore_items`; the two newest are kept so a reader can finish paging, and a round logs only its generation, its counts and its milliseconds.
- **Reading.** `GET /api/timeline/explore` shows only the order, never a score, count or position. Its cursor names the ranking and the last post read; a pruned ranking answers 409 `explore_refreshed`, and the app goes on from the newest ranking without repeating a post. Moderation states, the author's switch or deletion, blocks in both directions and mutes apply at every read. Signed out: the first 20 posts and no cursor. Every answer is `no-store`.
- **Authors.** Settings > Privacy has "Show my posts in Explore" (`POST` and `DELETE /api/me/explore`, on by default): off takes the posts out at the next read, on brings them back at the next refresh. `GET /api/posts/:id/explore` tells the author alone whether a post is in Explore and which rule keeps it out, never with a count, and the author's listed posts show "In Explore".
- **Tests.** A ranking is a function of the time it is computed at, so the integration suites rank in past epochs of their own (2020 to 2023), each test in its own span after emptying `explore_runs`.

## Staff roles
No API endpoint changes roles. Run this on the server:
```bash
docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>
```
Every session of the account is revoked and the change is written to the audit log. Staff tools refuse moderators and admins until they turn on two-factor authentication.

## Profile and account
Signed-in accounts manage themselves under Settings; every route below needs the session and, where it says fresh, a re-authentication within five minutes (the app opens its panel when the API answers `reauth_required`).
- **Profile.** `PATCH /api/me/profile` sets the display name (up to 50 characters) and the bio (one line, up to 160). `POST /api/me/handle` (fresh) changes the handle once every 30 days; every handle an account ever had stays reserved for it in `handle_history`, so nobody else can take an old handle and the account can go back to it. There is no redirect from an old handle.
- **Email.** `POST /api/auth/email/change/start` (fresh) sends a code to the new address; `POST /api/auth/email/change/verify` moves the account there and tells the old address, whose notice carries a link (`/email-revert/<token>`, `POST /api/auth/email/revert`, valid 24 hours, once) that moves the account back and runs the lockdown described under Passkeys and fresh authentication (every session and device signed out, the password removed, passkeys and two-factor authentication set up since the day before the change removed). Sessions stay signed in after a change.
- **Verified badge.** Proof of holding a phone number, kept only as a keyed hash; one number per account. `VERIFY_PROVIDER` picks who sends the text: `off` (default; the badge is hidden), `dev` (the code is always `000000`; refused in production) or `vonage` (Vonage Verify v2 with `VONAGE_API_KEY`, `VONAGE_API_SECRET` and `VERIFY_BRAND`; the runbook is section 13 of `docs/superpowers/specs/2026-09-24-account-lifecycle-1b-design.md`, and `node scripts/verify-badge.mjs +4479xxxxxxxx` checks live credentials without touching an account). Routes: `POST /api/auth/badge/start`, `POST /api/auth/badge/verify`, `DELETE /api/auth/badge` (all fresh); starts are limited per account, per number, per IP and instance-wide (200 texts a day), and a flow takes at most five codes. The web build shows the badge section only with `WEB_BADGE=on` in `infra/.env` (the default is off, matching `API_VERIFY_PROVIDER=off`); set both together.
- **Data export.** `POST /api/account/export` (fresh, once a day) streams a ZIP with `export.json` (the account with its passkeys' names and dates, profile, posts, likes, reposts, bookmarks, following, blocks, mutes, sessions, devices and security events) and every image the account uploaded under `media/`. Nothing is kept on the server: the archive is written entry by entry (ZIP64 when it passes 4 GiB or 65,535 entries), `export.json` is read in pages and streamed last, image files go through the media module's checked open, a request that fails before the first byte gives the day's export back, and one that fails midway breaks the download instead of saving a truncated archive.
- **Deletion.** `POST /api/account/delete/start` (fresh) mails a code; `POST /api/account/delete/confirm` with the code and the handle typed by the owner deletes the account at once: every session is revoked, posts become tombstones with their images and any pending uploads deleted from disk, likes, reposts, bookmarks, follows, blocks and mutes go with their counters, the profile is anonymised and keeps its handle, and the auth row is anonymised. The `account-purge` job (every five minutes) finishes any deletion the process did not. Nothing can be undone.
## Passkeys and fresh authentication
An account can sign in and confirm sensitive changes with a passkey (WebAuthn), beside the emailed code, the password and two-factor codes. The API verifies through `@simplewebauthn/server`, which only `apps/api/src/auth/passkeys/webauthn.ts` imports; that module pins korbat's settings and adds its own checks.
- **Settings.** `API_WEBAUTHN_RP_ID` is the domain passkeys are bound to (default: the host of `API_APP_ORIGIN`) and `API_WEBAUTHN_RP_NAME` the name a browser shows (default `korbat`). Production refuses `localhost`, an IP address and anything that is not the origin's host or a parent domain of it. Browsers offer passkeys only on `https` or on `http://localhost`, never on an IP address.
- **Adding.** `POST /api/auth/passkeys/register/options` and `/verify`. Up to 10 passkeys, 5 added a day. User verification (fingerprint, face or PIN) is asked for and never required; only the attestation formats `none` and self-attested `packed` are accepted, so nothing is fetched from an authenticator's maker. The owner is mailed a link (`/passkey-remove/<token>`, valid 7 days, once) that removes the passkey and locks the account down.
- **Managing.** `GET /api/auth/passkeys` lists them (name, dates, synced, the device that added it, new, suspended); `PATCH /api/auth/passkeys/:id` renames and `DELETE` removes, the last one too. "This wasn't me" on a passkey of the last 7 days (`POST /api/auth/passkeys/:id/not-mine`) runs the lockdown.
- **Signing in.** `POST /api/auth/passkey/signin/options` and `/verify` need no email: the browser offers the passkeys it holds for the domain, from the button or from the email field's autofill. A sign-in whose passkey verified the user counts as two factors; one that did not is followed by the two-factor code on an account that has two-factor authentication, and staff always give the code. A signature counter that goes backwards switches the passkey off, mails the owner and refuses the sign-in.
- **Fresh authentication has two levels.** A session records what it proved and when. Level 1 is any factor in the last five minutes; level 2 is a user-verified passkey, or a two-factor or recovery code beside an email code, a password or a passkey. An account with two-factor authentication needs level 2 to add or remove a passkey, change its password or email, set up, turn off or re-issue two-factor codes, and delete itself; every other account needs level 1. A refusal is `reauth_required` with `details: { level, have }`, and `POST /api/auth/reauth` (password, emailed code, two-factor code, recovery code or passkey) answers the level reached and rotates the session's token in place, so a copy of the old token stops working. Sessions are listed and revoked by an id that survives the rotation.
- **Lockdown.** Every "this wasn't me" runs one routine: the new-device alert's link, the passkey mail's remove link, the button on a new passkey, and the email change's undo. It signs out every session and device, removes the password, and removes the passkeys and two-factor authentication set up since the day before the event, in one transaction; the owner gets back in with a code sent to their email. A mailed link is tied to the address it went to: it does nothing while the account is at another address and works again once the address is restored.
- **What is kept.** The public key, the credential's id, its counter, whether it is synced and was registered with user verification, its name, and the device that added it; nothing about a fingerprint or a face ever leaves the person's device. The export lists names and dates only, and deleting the account deletes the passkeys.
- **After restoring a backup** the counters in the database are older than the authenticators': run `update auth.passkeys set counter = 0, suspect_at = null where suspect_at is null or suspect_at > '<restore time>';` so no passkey is refused as a copy (section 11 of `docs/superpowers/specs/2026-09-25-passkeys-1c-design.md`).
- **Tests.** A software authenticator (`apps/api/test/auth/soft-authenticator.ts`) runs whole ceremonies in the unit and integration suites. The API prints two `ExperimentalWarning`s at start, from the library's probe of Node 24's ML-DSA support; they are expected.
## Before going public
Set these in `infra/.env`:
- `API_APP_ORIGIN` to the public origin, for example `https://korbat.example`; the API refuses a plain-http origin in production.
- `API_TURNSTILE_SECRET_KEY` and `WEB_TURNSTILE_SITE_KEY` to the keys of one Turnstile widget; the API and the web build refuse Cloudflare's test keys in production.
- `API_SMTP_URL` and `API_MAIL_FROM` to the EU mail relay; a plain `smtp://` relay must offer STARTTLS, which the API requires in production.
- `API_WEBAUTHN_RP_ID` before the first passkey is registered, when it should differ from the host of `API_APP_ORIGIN`: the apex domain lets a later subdomain (an admin console) share passkeys, and changing it afterwards strands every passkey.
- `KORBAT_ENV=production` before building the images; it is the API's `NODE_ENV` too, so the guards above are on.
- `TUNNEL=on` and `API_TRUST_PROXY=cloudflare` when cloudflared is the only way in (the tunnel's hostname points at `http://caddy:8080`); `TUNNEL=off` and `API_TRUST_PROXY=caddy` when Caddy's port is reachable directly. With `on`, Caddy keeps `CF-Connecting-IP` for the API; with `off` it drops it, so nobody can claim an address.
- In Cloudflare, set Browser Cache TTL to "Respect Existing Headers", or browsers keep images for four hours whatever the server says.

Keep `API_AUTH_HMAC_KEY`, `API_IP_HASH_KEY` and `API_TOTP_ENC_KEY` secret and backed up. Losing `API_TOTP_ENC_KEY` breaks every enrolled authenticator. To rotate it, put the old key in `API_TOTP_ENC_KEYS_PREVIOUS` and a new `v2:` key in `API_TOTP_ENC_KEY`; each secret is re-encrypted with the new key when it is next used.

Explore relies on sub-project 3's moderation states: until moderators can withhold or remove a post, only its author takes a rule-breaking post out of Explore, by deleting it or switching Explore off. Its cold start lasts about two days: only accounts at least 48 hours old count, so on a new instance Explore stays empty until the first accounts are that old.

## Dependency audit

`pnpm audit --audit-level high` runs in CI. Two lower advisories are accepted, both in build-time tools that never see untrusted input here: `esbuild` 0.18 under drizzle-kit's config loader (its development server, which nothing starts) and `uuid` 7 under Expo's Xcode config plugin. Renovate moves them with their parents.
````

### Replace `apps/admin/README.md` (whole file)

````markdown
# @korbat/admin

The staff console of sub-project 3a (`docs/superpowers/specs/2026-09-28-staff-console-3a-design.md`): a React page bundled by esbuild with plain CSS, built into Caddy's image and served by Caddy's console site on `CONSOLE_ORIGIN`, an origin of its own apart from the app's. Cloudflare Access in front of it is an optional extra gate. The page talks only to `/api/staff/*` on its own origin, and only a staff key opens it: sign-in, enrolment from a link `staff.js enroll` printed, the home screen (who is signed in, every staff account's sign-ins of the last 7 days, your staff sessions, your keys) and the audit log. Cases arrive in sub-project 3c.

It runs under a strict Content Security Policy with Trusted Types (`site-headers.mjs`, which Caddy's console site sends too): scripts, styles, images and requests from its own origin only, and no HTML or script sink at all. Every string a person wrote is rendered as text, zod is jitless, and no link is built from data; `test/source.test.ts` keeps it so.

## Commands

```bash
pnpm --filter @korbat/admin build   # dist/: index.html, the hashed bundle and stylesheet under assets/, favicon.svg
pnpm --filter @korbat/admin dev     # esbuild in watch mode and the console on http://localhost:8090
pnpm --filter @korbat/admin test    # server-rendered screens, the page's logic, source scans, the build and the dev server
pnpm --filter @korbat/admin typecheck
```

The development server serves the build with the console site's headers, the policy included, on `127.0.0.1:8090` (`--port <number>` moves it: `pnpm --filter @korbat/admin dev --port 8091`), and forwards `/api/staff/*` to the API at `http://localhost:3000` with the `Host` header kept, so the API's staff gate sees the console's host. Start the API first (`pnpm --filter @korbat/api dev`) with `CONSOLE_ORIGIN=http://localhost:8090` in `apps/api/.env` (`node scripts/gen-dev-env.mjs` adds it), naming the same port. Open the console at `http://localhost:8090`, never `127.0.0.1`: browsers refuse WebAuthn on an IP address. A page that says the console is not available at this address means the API answered `/api/staff/me` with 404: `CONSOLE_ORIGIN` is unset, or names another address.
````

### Replace `apps/admin/package.json` (whole file)

```json
{
  "name": "@korbat/admin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "dev": "node dev.mjs",
    "typecheck": "tsc -p .",
    "test": "vitest run"
  },
  "dependencies": {
    "@korbat/contracts": "workspace:*",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@types/node": "24.13.5",
    "@types/react": "19.2.18",
    "esbuild": "0.28.2",
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
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
# Who checks the phone number behind the verified badge: off hides the badge, dev accepts the code 000000
# (development only; production refuses it), vonage texts a real code and needs VONAGE_API_KEY,
# VONAGE_API_SECRET and VERIFY_BRAND (1 to 18 characters), see infra/.env.example.
VERIFY_PROVIDER=dev
# Passkeys. The RP ID every passkey is bound to: empty means the host of APP_ORIGIN (localhost here). Production
# refuses an address or localhost and accepts only that host or a parent domain of it; changing it later strands
# every passkey. Browsers refuse passkeys on an IP address, so open the app at http://localhost, not 127.0.0.1.
WEBAUTHN_RP_ID=
# The site name password managers show next to a korbat passkey (1 to 64 printable characters); empty means korbat.
WEBAUTHN_RP_NAME=
# The staff console (apps/admin): its origin turns the staff routes on, and empty turns them off. Its development
# server (pnpm --filter @korbat/admin dev) listens on this port and forwards /api/staff/* to this API; open it at
# exactly this address, never 127.0.0.1. It must differ from APP_ORIGIN and never appear in TRUSTED_ORIGINS. Staff keys
# are bound to its relying party ID, CONSOLE_RP_ID, which defaults to its hostname: localhost here, as for passkeys.
CONSOLE_ORIGIN=http://localhost:8090
```

## Step 4: verify: frozen-install

```bash
pnpm install --frozen-lockfile
```

Expected output contains:

- `Done in`

Must not contain:

- `ERR_PNPM`

Observed on the dry run:

```text
Done in 1.9s using pnpm v10.30.0
```

## Step 5: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `all at least 7 days old`

Observed on the dry run:

```text
0 new package versions since HEAD; all at least 7 days old
```

## Step 6: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 7: verify: test

```bash
pnpm test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/db test:       Tests  40 passed (40)
packages/contracts test:       Tests  139 passed (139)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  108 passed (108)
apps/admin test:       Tests  167 passed (167)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  548 passed | 438 skipped (986)
```

## Step 8: verify: admin-test

```bash
pnpm --filter @korbat/admin test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  167 passed (167)
```

## Step 9: verify: admin-build

```bash
pnpm --filter @korbat/admin build 2>&1 | tail -2 && ls apps/admin/dist apps/admin/dist/assets | sed -E 's/-[A-Z0-9]{8}\./-HASH./'
```

Expected output contains:

- `Build success`
- `index.html`
- `favicon.svg`
- `main-HASH.js`
- `main-HASH.css`

Observed on the dry run:

```text
Build success
favicon.svg
index.html
main-HASH.js
main-HASH.css
```

## Step 10: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  436 passed (436)
```

## Step 11: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `.github/workflows/ci.yml`
- `README.md`
- `apps/admin/README.md`
- `apps/admin/build.d.mts`
- `apps/admin/build.mjs`
- `apps/admin/dev-server.d.mts`
- `apps/admin/dev-server.mjs`
- `apps/admin/dev.mjs`
- `apps/admin/package.json`
- `apps/admin/public/favicon.svg`
- `apps/admin/site-headers.d.mts`
- `apps/admin/site-headers.mjs`
- `apps/admin/src/App.tsx`
- `apps/admin/src/Layout.tsx`
- `apps/admin/src/api.ts`
- `apps/admin/src/app.css`
- `apps/admin/src/audit-log.ts`
- `apps/admin/src/css.d.ts`
- `apps/admin/src/enroll.ts`
- `apps/admin/src/idle.ts`
- `apps/admin/src/main.tsx`
- `apps/admin/src/messages.ts`
- `apps/admin/src/nav.tsx`
- `apps/admin/src/react-dom.d.ts`
- `apps/admin/src/router.ts`
- `apps/admin/src/screens/Audit.tsx`
- `apps/admin/src/screens/Enroll.tsx`
- `apps/admin/src/screens/Home.tsx`
- `apps/admin/src/screens/SignIn.tsx`
- `apps/admin/src/screens/Unavailable.tsx`
- `apps/admin/src/signins.ts`
- `apps/admin/src/step-up.ts`
- `apps/admin/src/store.ts`
- `apps/admin/src/ui.tsx`
- `apps/admin/src/webauthn.ts`
- `apps/admin/src/zod-jitless.ts`
- `apps/admin/test/api.test.ts`
- `apps/admin/test/audit-log.test.ts`
- `apps/admin/test/build.test.ts`
- `apps/admin/test/dev-server.test.ts`
- `apps/admin/test/enroll.test.ts`
- `apps/admin/test/fixtures.ts`
- `apps/admin/test/idle.test.ts`
- `apps/admin/test/router.test.ts`
- `apps/admin/test/screens.test.tsx`
- `apps/admin/test/signins.test.ts`
- `apps/admin/test/source.test.ts`
- `apps/admin/test/step-up.test.ts`
- `apps/admin/test/store.test.ts`
- `apps/admin/test/webauthn.test.ts`
- `apps/admin/tsconfig.json`
- `apps/admin/vitest.config.ts`
- `apps/api/.env.example`
- `pnpm-lock.yaml`

## Step 12: commit

```bash
git add -A
git commit -q -m "feat(admin,ci): the staff console: apps/admin is a React page bundled by esbuild into one hashed script and stylesheet with jitless zod, no HTML sinks and every user-written string rendered as text, under the console site's strict policy; it signs in with a staff key, enrols a key from a link with guidance on which keys work and words for every refusal, lists the staff sign-ins of the last 7 days, the person's sessions and keys, and the audit log with Load older and Go to place; before it asks for the key it recomputes the step-up challenge's binding from the session and the action it means to confirm; its idle timer counts only the person's own actions, warns two minutes before the end and never past the 12-hour end; pnpm --filter @korbat/admin dev serves it on 127.0.0.1:8090 beside the API with the same headers; CI builds it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(admin,ci): the staff console: apps/admin is a React page bundled by esbuild into one hashed script and stylesheet with jitless zod, no HTML sinks and every user-written string rendered as text, under the console site's strict policy; it signs in with a staff key, enrols a key from a link with guidance on which keys work and words for every refusal, lists the staff sign-ins of the last 7 days, the person's sessions and keys, and the audit log with Load older and Go to place; before it asks for the key it recomputes the step-up challenge's binding from the session and the action it means to confirm; its idle timer counts only the person's own actions, warns two minutes before the end and never past the 12-hour end; pnpm --filter @korbat/admin dev serves it on 127.0.0.1:8090 beside the API with the same headers; CI builds it`.

## Report format (mandatory)

```text
TASK 6 REPORT
Files written: <count, expected 53>
Failing-test step (the error line): <paste>
Verify "frozen-install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "admin-test": <paste the expected lines as printed>
Verify "admin-build": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
