# korbat staff console (3a) — Task 7 of 9: Infrastructure for the staff console: Caddy's console site on 8090 with the console's headers, the app's site refusing /api/staff, the image's console stage, Compose and the development port, the environment template, the smoke test's console checks, and the committed browser check run in CI

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-30 and 2026-10-01 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Tasks 1 to 6 built the staff console's API side and the console app. This task serves it: Caddy's console site and the app site's refusal of staff paths, the image's console stage, Compose, the environment template, the smoke test's console checks and the committed browser check. The design is `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md` (sections 8 and 12).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000, 8080 and 8090 on localhost must be free. Stop any korbat API, worker, web or console process started from this repository first; never stop other Node processes on the machine, and never touch Docker containers, volumes or images that do not belong to the `korbat` compose project.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(admin,ci): the staff console: apps/admin is a React page bundled by esbuild into one hashed script and stylesheet with jitless zod, no HTML sinks and every user-written string rendered as text, under the console site's strict policy; it signs in with a staff key, enrols a key from a link with guidance on which keys work and words for every refusal, lists the staff sign-ins of the last 7 days, the person's sessions and keys, and the audit log with Load older and Go to place; before it asks for the key it recomputes the step-up challenge's binding from the session and the action it means to confirm; its idle timer counts only the person's own actions, warns two minutes before the end and never past the 12-hour end; pnpm --filter @korbat/admin dev serves it on 127.0.0.1:8090 beside the API with the same headers; CI builds it`.

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
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/07-console-infrastructure.md 1
```

Expected: 7 lines starting with `wrote`, one for each file below.

### Create `apps/admin/test/browser/console.browser.ts`

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildConsole } from "../../build.mjs";
import { CONSOLE_CSP } from "../../site-headers.mjs";
import { messageFor, STAFF_MESSAGES } from "../../src/messages";
import { UNAVAILABLE_TEXT } from "../../src/screens/Unavailable";
import { SIGN_IN_WINDOW_MS } from "../../src/signins";
import { clockTime } from "../../src/ui";
import { consoleSiteHeadersFromCaddyfile } from "../caddyfile";
import { createFixtureApi, CURRENT_BROWSER, EXISTING_KEY_NAMES, HOSTILE_TEXTS, OTHER_BROWSERS, PERSON_HANDLE, TYPED_KEY_NAME, type FixtureApi } from "./fixture-api";
import { startConsoleSite, type ConsoleSiteServer } from "./server";
import { inspect, userTexts, watch, type Watcher } from "./watch";

/**
 * The console's browser check (3a design, section 12). It builds the console, serves the build with the routes and headers
 * of Caddy's console site read from infra/caddy/Caddyfile, answers /api/staff/* from fixtures whose user-written strings
 * are hostile (markup, javascript: URLs, a direction override, the longest names allowed), and drives Chromium through
 * playwright-core with a CDP virtual authenticator over every screen: the console switched off, enrolment (a synced
 * passkey refused, then a device-bound key that verifies its user), sign-in, home, a session revoked with the key, step-up
 * options that bind another action refused before the key is asked, the audit log, an address the console does not have,
 * the ended session and sign-out. Each step fails on any policy report through any channel console-lab.md names, any page
 * error and any dialog. It needs no database and writes nothing but a temporary build.
 *
 * It never downloads a browser. By default it drives the Chromium build playwright-core 1.63.0 names (chromium-1243 under
 * ms-playwright), which must already be installed; KORBAT_BROWSER_CHANNEL=chrome drives the machine's own Chrome instead,
 * as CI does with the runner's.
 */
const CHANNEL = process.env.KORBAT_BROWSER_CHANNEL || "chromium";

let out = "";
let site: ConsoleSiteServer | undefined;
let browser: Browser | undefined;
let context: BrowserContext;
let page: Page;
let watcher: Watcher;
let fixtures: FixtureApi;
let origin = "";
/** The device-bound authenticator that holds the enrolled staff key. */
let staffAuthenticator = "";
/** Every person-written string the walk has found shown as text. */
const seen = new Set<string>();
/** The headers each static file was served with, by path. */
const served = new Map<string, Record<string, string>>();

/** The text of every element holding a person-written string or an action, kept in `seen`. */
async function texts(): Promise<string[]> {
  const found = await userTexts(page);
  for (const text of found) seen.add(text);
  return found;
}

/** Waits for a locator to show, failing with what it looked for. */
async function shown(locator: Locator, timeout = 15_000): Promise<void> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
  } catch {
    throw new Error(`not shown within ${timeout} ms: ${locator.toString()}`);
  }
}

/** A virtual CTAP2 authenticator that verifies its user: a security key on USB, or a platform one whose passkeys sync. */
async function addAuthenticator(kind: "device-bound security key" | "synced platform passkey"): Promise<string> {
  const synced = kind === "synced platform passkey";
  const { authenticatorId } = await watcher.cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: synced ? "internal" : "usb",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      // The flags a password manager's passkey reports, and a security key never does.
      defaultBackupEligibility: synced,
      defaultBackupState: synced,
    },
  });
  return authenticatorId;
}

/** How many assertions the staff key has made: the virtual authenticator counts every signature. */
async function signatures(): Promise<number> {
  const { credentials } = await watcher.cdp.send("WebAuthn.getCredentials", { authenticatorId: staffAuthenticator });
  return credentials.reduce((sum, credential) => sum + credential.signCount, 0);
}

/** The end of every step: no report, error or dialog on any channel, nothing in the page the console never writes, and no request the fixtures refused for the page's fault. */
async function clean(): Promise<void> {
  expect(watcher.take()).toEqual([]);
  expect(await inspect(page)).toEqual([]);
  expect(fixtures.state.problems).toEqual([]);
}

beforeAll(async () => {
  out = mkdtempSync(path.join(tmpdir(), "korbat-admin-browser-"));
  await buildConsole({ outdir: out });
  fixtures = createFixtureApi();
  site = await startConsoleSite({ dist: out, api: fixtures.handle });
  origin = site.origin;
  fixtures.state.origin = origin;
  browser = await chromium.launch({ channel: CHANNEL, headless: true });
  context = await browser.newContext({ timezoneId: "UTC", locale: "en-GB", viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  watcher = await watch(context, page, origin);
  await watcher.cdp.send("WebAuthn.enable", { enableUI: false });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/")) served.set(url.pathname, response.headers());
  });
});

afterAll(async () => {
  await browser?.close();
  await site?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

describe("the staff console in Chromium, under the console site's policy", () => {
  test("the page, its script and its stylesheet come with the Caddyfile's console headers, the policy of section 3 among them", async () => {
    fixtures.state.off = true;
    await page.goto(`${origin}/`);
    await shown(page.getByText(UNAVAILABLE_TEXT));
    const headersFor = consoleSiteHeadersFromCaddyfile();
    expect(headersFor("/", false)["Content-Security-Policy"]).toBe(CONSOLE_CSP);
    const assets = [...served.keys()].filter((p) => p.startsWith("/assets/"));
    expect(assets.map((p) => path.extname(p)).sort()).toEqual([".css", ".js"]);
    // The page is index.html answered for "/", which names no file; the script and the stylesheet are files of the build.
    for (const p of ["/", ...assets]) {
      const sent = served.get(p)!;
      for (const [name, value] of Object.entries(headersFor(p, p !== "/"))) expect(sent[name.toLowerCase()], `${p} ${name}`).toBe(value);
    }
    expect(served.get("/")!["cache-control"]).toBe("no-store, no-transform");
    for (const p of assets) expect(served.get(p)!["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  test("a console that is off shows only that it is not available at this address", async () => {
    expect(await page.locator("#root").innerText()).toBe(UNAVAILABLE_TEXT);
    expect(await page.getByRole("button").count()).toBe(0);
    fixtures.state.off = false;
    await clean();
  });

  test("enrolment: a synced passkey is refused and explained while the link still works, then a device-bound key registers", async () => {
    const synced = await addAuthenticator("synced platform passkey");
    await page.goto(`${origin}/enroll/${fixtures.state.enrolmentToken}`);
    await shown(page.getByRole("heading", { name: "Register a staff key" }));
    await page.getByLabel("Name of this key").fill(TYPED_KEY_NAME);
    await page.getByRole("button", { name: "Use Windows Hello on this computer" }).click();
    await shown(page.getByText(STAFF_MESSAGES.staff_key_not_device_bound));
    await shown(page.getByText("This link still works", { exact: false }));
    // The console's relying party ID is not the app's here, so the page asked the browser to drop the refused passkey, or
    // says to delete it by hand where the browser could not.
    await shown(page.getByText(/asked to remove the refused passkey|Delete the refused entry/));
    expect(fixtures.state.enrolmentUsed).toBe(false);
    await clean();

    await watcher.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: synced });
    staffAuthenticator = await addAuthenticator("device-bound security key");
    await page.getByRole("button", { name: "Register a security key" }).click();
    await shown(page.getByText("is registered", { exact: false }));
    expect(await texts()).toContain(TYPED_KEY_NAME);
    expect(fixtures.state.enrolmentUsed).toBe(true);
    await clean();
  });

  test("sign-in with the new key opens the home screen", async () => {
    await page.getByRole("link", { name: "Sign in" }).click();
    await page.waitForURL(`${origin}/signin`);
    await shown(page.getByRole("button", { name: "Sign in with your staff key" }));
    // Nobody was signed in, so nothing ended.
    expect(await page.getByText("Your staff session ended.").count()).toBe(0);
    // The registration counted as one use of the key; the sign-in is the next.
    const before = await signatures();
    await page.getByRole("button", { name: "Sign in with your staff key" }).click();
    await shown(page.getByRole("heading", { name: "Home" }));
    expect(page.url()).toBe(`${origin}/`);
    expect(await signatures()).toBe(before + 1);
    await clean();
  });

  test("home: who is signed in, the sign-ins of 7 days, the sessions and the keys, every written string as text", async () => {
    const current = [...fixtures.state.sessions.values()].find((s) => s.browser === CURRENT_BROWSER)!;
    await shown(page.getByText(`Signed in until ${clockTime(new Date(current.createdAt + 12 * 60 * 60_000).toISOString())}.`));
    await shown(page.locator("ul.signins"));
    await shown(page.locator("ul.keys"));
    await shown(page.getByRole("cell", { name: "This session" }));
    // Every sign-in of the last 7 days, read page by page, and none older.
    const since = Date.now() - SIGN_IN_WINDOW_MS;
    const recent = fixtures.state.audit.filter((row) => row.action === "staff_sign_in" && Date.parse(row.createdAt) >= since);
    expect(recent.length).toBeGreaterThan(50);
    expect(await page.locator("ul.signins li").count()).toBe(recent.length);
    expect(fixtures.state.requests.filter((r) => r.path.startsWith("/api/staff/audit?action=staff_sign_in")).length).toBe(2);
    // The sessions: this one and the two others; the keys: the two the person held and the new one.
    expect(await page.locator("table tbody tr").count()).toBe(3);
    expect(await page.locator("ul.keys li").count()).toBe(EXISTING_KEY_NAMES.length + 1);
    const shownTexts = await texts();
    for (const text of [PERSON_HANDLE, CURRENT_BROWSER, ...OTHER_BROWSERS, ...EXISTING_KEY_NAMES, TYPED_KEY_NAME]) expect(shownTexts, text).toContain(text);
    await clean();
  });

  test("a session revoked with the key: the step-up's options check out, the key signs once, and the session goes", async () => {
    const before = await signatures();
    const target = [...fixtures.state.sessions.values()].find((s) => s.browser === OTHER_BROWSERS[0])!;
    const row = page.locator("table tbody tr").filter({ hasText: OTHER_BROWSERS[0] });
    await row.getByRole("button", { name: "Sign out that session" }).click();
    await shown(page.getByText("That session is signed out."));
    await row.waitFor({ state: "detached" });
    expect(await signatures()).toBe(before + 1);
    expect(fixtures.state.revoked).toEqual([target.handle]);
    expect(await page.locator("table tbody tr").count()).toBe(2);
    await clean();
  });

  test("step-up options that bind another action are refused before the key is asked", async () => {
    const before = await signatures();
    const optionsBefore = fixtures.state.stepUpOptionsServed;
    const deletes = fixtures.state.requests.filter((r) => r.method === "DELETE").length;
    fixtures.state.mismatchNextStepUp = true;
    const row = page.locator("table tbody tr").filter({ hasText: OTHER_BROWSERS[1] });
    await row.getByRole("button", { name: "Sign out that session" }).click();
    await shown(page.getByText(messageFor("step_up_mismatch")));
    expect(fixtures.state.stepUpOptionsServed).toBe(optionsBefore + 1);
    // The key signed nothing, no revocation was sent, and the session is still listed.
    expect(await signatures()).toBe(before);
    expect(fixtures.state.requests.filter((r) => r.method === "DELETE").length).toBe(deletes);
    expect(await row.count()).toBe(1);
    await clean();
  });

  test("the audit log: the newest page, Load older, Go to place and back to the newest", async () => {
    await page.getByRole("link", { name: "Audit log" }).click();
    await page.waitForURL(`${origin}/audit`);
    const rows = page.locator("table.audit tbody tr");
    await shown(rows);
    const newest = fixtures.state.audit[0]!.seq;
    expect(await rows.count()).toBe(50);
    expect(await rows.first().locator("td").first().textContent()).toBe(String(newest));
    await page.getByRole("button", { name: "Load older" }).click();
    await rows.nth(50).waitFor();
    expect(await rows.count()).toBe(100);
    await page.getByLabel("Place").fill("75");
    await page.getByRole("button", { name: "Go to place" }).click();
    await shown(page.getByText("From place 75, newest first."));
    expect(await rows.first().locator("td").first().textContent()).toBe("75");
    const shownTexts = await texts();
    for (const row of fixtures.state.audit.filter((r) => r.seq <= 75 && r.seq > 25)) {
      for (const text of [row.actorHandle, row.action, row.targetType, row.targetId, row.hash]) if (text !== null) expect(shownTexts, text).toContain(text);
    }
    await page.getByRole("button", { name: "Newest" }).click();
    await page.getByText("From place 75, newest first.").waitFor({ state: "detached" });
    expect(await rows.first().locator("td").first().textContent()).toBe(String(newest));
    await clean();
  });

  test("an address the console does not have says so, inside the console", async () => {
    await page.goto(`${origin}/no/such/page`);
    await shown(page.getByRole("heading", { name: "No such page" }));
    await page.getByRole("link", { name: "Go to the home page" }).click();
    await shown(page.getByRole("heading", { name: "Home" }));
    // Every read the home screen started has finished before the walk moves on, so none is in flight when the session ends.
    await shown(page.locator("ul.signins"));
    await shown(page.locator("ul.keys"));
    await shown(page.getByRole("cell", { name: "This session" }));
    await page.getByRole("link", { name: "Audit log" }).click();
    await shown(page.locator("table.audit tbody tr"));
    await clean();
  });

  test("the ended session: sign-in in place at the same address, both staff cookies gone, and the same page after", async () => {
    fixtures.endEverySession();
    await page.getByRole("button", { name: "Load older" }).click();
    await shown(page.getByText("Your staff session ended."));
    expect(page.url()).toBe(`${origin}/audit`);
    expect((await context.cookies()).filter((cookie) => cookie.name.startsWith("__Host-korbat_staff"))).toEqual([]);
    await page.getByRole("button", { name: "Sign in with your staff key" }).click();
    await shown(page.getByRole("heading", { name: "Audit log" }));
    await shown(page.locator("table.audit tbody tr"));
    expect(page.url()).toBe(`${origin}/audit`);
    await clean();
  });

  test("sign-out ends the session and shows sign-in at its own address", async () => {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(`${origin}/signin`);
    await shown(page.getByRole("button", { name: "Sign in with your staff key" }));
    expect(await page.getByText("Your staff session ended.").count()).toBe(0);
    expect(fixtures.state.sessions.size).toBe(0);
    await clean();
  });

  test("every request the walk sent was its person's own, marked, and every string the fixtures wrote was shown as text", () => {
    expect(watcher.take()).toEqual([]);
    expect(fixtures.state.requests.length).toBeGreaterThan(20);
    expect(fixtures.state.requests.filter((r) => !r.activity)).toEqual([]);
    expect(fixtures.state.problems).toEqual([]);
    expect(HOSTILE_TEXTS.filter((text) => !seen.has(text))).toEqual([]);
  });
});
```

### Create `apps/admin/test/browser/fixture-api.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  STAFF_AUDIT_PAGE_SIZE,
  STAFF_STEP_UP_CHALLENGE,
  StaffEnrollOptionsRequest,
  StaffEnrollVerifyRequest,
  StaffSessionRevokeRequest,
  StaffSignInVerifyRequest,
  StaffStepUpOptionsRequest,
  stepUpActionHash,
  stepUpBinding,
  type AuditEntry,
  type AuditPage,
  type StaffKey,
  type StaffMe,
  type StaffSession,
  type StaffStepUpActionInput,
} from "@korbat/contracts";
import type { z } from "zod";
import { HOSTILE } from "../fixtures";

/**
 * The staff API as the browser check answers it (3a design, section 12): no database and no API process, only answers
 * from fixtures held in memory, shaped by the contracts, whose user-written strings are hostile. It checks what a real
 * browser sends, as far as the console's part goes: the staff gate's Host, Origin and fetch metadata, the staff CSRF
 * header on every write, the WebAuthn ceremonies' client data (type, challenge, origin) and the authenticator's flags
 * (user verified, never backup-eligible or backed up). Anything the page sent that the real API would refuse for the
 * page's own fault is listed in `problems`. Signatures are not verified: the API's own tests do that with its library.
 */

/** The longest handle an account can choose (checkHandle: 3 to 20 of a-z, 0-9 and _). */
export const LONGEST_HANDLE = "h".repeat(20);

/** The name typed for the new key at enrolment: markup, within the display-name rules the page checks it against. */
export const TYPED_KEY_NAME = '"><img src=x onerror=alert(9)>';

/** The signed-in person's handle, and the browser labels of their sessions, as an API made to echo them would send them. */
export const PERSON_HANDLE = HOSTILE.script;
export const CURRENT_BROWSER = HOSTILE.url;
export const OTHER_BROWSERS = [HOSTILE.img, HOSTILE.bidi] as const;
/** The keys the person already holds, by name: the longest name allowed (50 characters), and more markup. */
export const EXISTING_KEY_NAMES = [HOSTILE.long, HOSTILE.quote] as const;
/** The handles the audit log's rows name, in turn; null is the system actor. */
export const ACTOR_HANDLES = [HOSTILE.script, HOSTILE.img, HOSTILE.url, HOSTILE.quote, HOSTILE.bidi, LONGEST_HANDLE, null] as const;

/** Every user-written string the console must show as text, exactly as written. */
export const HOSTILE_TEXTS = [
  ...new Set([PERSON_HANDLE, CURRENT_BROWSER, ...OTHER_BROWSERS, ...EXISTING_KEY_NAMES, TYPED_KEY_NAME, ...ACTOR_HANDLES.filter((h) => h !== null)]),
];

const HOUR = 60 * 60_000;
const IDLE_MS = 15 * 60_000;
const ABSOLUTE_MS = 12 * HOUR;
/** How far apart the audit log's rows are: 97 minutes, so none sits within an hour of the home screen's 7-day edge. */
const ROW_SPACING_MS = 97 * 60_000;
const AUDIT_ROWS = 160;

/** The authenticator data's flags (WebAuthn L3, section 6.1). */
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;

const iso = (ms: number) => new Date(ms).toISOString();
const hex64 = () => randomBytes(32).toString("hex");
const b64url = (bytes: number) => randomBytes(bytes).toString("base64url");

interface KeyRecord extends StaffKey {
  /** The credential the browser made; null for the keys the person held before the walk, which no authenticator holds. */
  credentialId: string | null;
}

interface SessionRecord {
  handle: string;
  token: string;
  csrf: string;
  browser: string;
  createdAt: number;
  lastUsedAt: number;
  /** The credential of the key that opened it; null for the fixtures' other sessions. */
  credentialId: string | null;
}

export interface RequestRecord {
  method: string;
  path: string;
  status: number;
  activity: boolean;
}

/**
 * The audit log: places 1 to 160, one row every 97 minutes up to now, so the newest page, Load older and Go to place each
 * have rows to show, and the home screen's sign-ins reach back past 7 days. Actions, targets and actors take hostile
 * values in turn.
 */
function auditLog(now: number): AuditEntry[] {
  const rows: AuditEntry[] = [];
  for (let seq = AUDIT_ROWS; seq >= 1; seq--) {
    const kind = seq % 4 === 0 ? "revoked" : seq % 9 === 0 ? "hostile" : "signin";
    rows.push({
      seq,
      hash: hex64(),
      createdAt: iso(now - (AUDIT_ROWS - seq) * ROW_SPACING_MS),
      actorHandle: ACTOR_HANDLES[seq % ACTOR_HANDLES.length] ?? null,
      action: kind === "revoked" ? "staff_session_revoked" : kind === "hostile" ? HOSTILE.script : "staff_sign_in",
      targetType: kind === "revoked" ? "staff_session" : kind === "hostile" ? HOSTILE.quote : null,
      targetId: kind === "revoked" ? randomUUID() : kind === "hostile" ? HOSTILE.url : null,
      actionHash: kind === "revoked" ? hex64() : null,
    });
  }
  return rows;
}

/** The authenticator data inside a CBOR attestation object: the byte string under the text key "authData". */
function authDataOf(attestationObject: Buffer): Buffer | null {
  // A CBOR text string of 8 bytes (0x68) spelling authData, then the byte string (major type 2) it maps to.
  const key = Buffer.concat([Buffer.from([0x68]), Buffer.from("authData")]);
  const at = attestationObject.indexOf(key);
  if (at === -1) return null;
  let i = at + key.length;
  const head = attestationObject[i];
  if (head === undefined || head >> 5 !== 2) return null;
  let length = head & 0x1f;
  i += 1;
  // The length is in the head itself, or in the 1, 2 or 4 bytes after it.
  if (length === 24) {
    length = attestationObject.readUInt8(i);
    i += 1;
  } else if (length === 25) {
    length = attestationObject.readUInt16BE(i);
    i += 2;
  } else if (length === 26) {
    length = attestationObject.readUInt32BE(i);
    i += 4;
  } else if (length > 23) {
    return null;
  }
  return attestationObject.subarray(i, i + length);
}

/** The flags byte of authenticator data, which follows the 32-byte hash of the relying party ID. */
const flagsOf = (authData: Buffer | null): number | null => (authData && authData.length > 32 ? authData[32]! : null);

/** The staff refusal for an authenticator's flags, or null: user verified, and neither backup-eligible nor backed up. */
function flagRefusal(flags: number | null): string | null {
  if (flags === null) return "staff_key_refused";
  if ((flags & FLAG_UV) === 0) return "staff_key_not_user_verified";
  if ((flags & (FLAG_BE | FLAG_BS)) !== 0) return "staff_key_not_device_bound";
  return null;
}

function cookies(req: IncomingMessage): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) jar.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return jar;
}

/** The staff cookies as the API sets them: __Host- names, Secure, Path=/, SameSite=Strict, 12 hours, the session's HttpOnly. */
const COOKIE = "Path=/; Secure; SameSite=Strict";
const SESSION_COOKIE = "__Host-korbat_staff";
const CSRF_COOKIE = "__Host-korbat_staff_csrf";
const CLEAR_COOKIES = [`${SESSION_COOKIE}=; ${COOKIE}; HttpOnly; Max-Age=0`, `${CSRF_COOKIE}=; ${COOKIE}; Max-Age=0`];

class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly headers: Record<string, string | string[]> = {},
  ) {
    super(code);
  }
}

type Answer = { status: number; body?: unknown; headers?: Record<string, string | string[]> };

export type FixtureApi = ReturnType<typeof createFixtureApi>;

export function createFixtureApi() {
  const now = Date.now();
  // The account's WebAuthn user handle, which the enrolment's options carry and a discoverable staff key returns.
  const userHandle = b64url(32);
  const state = {
    /** The origin the page is served from, set once the server listens. */
    origin: "",
    /** The console is off: every staff path answers 404, as the API does while CONSOLE_ORIGIN is unset. */
    off: false,
    enrolmentToken: b64url(32),
    enrolmentUsed: false,
    /** The next step-up options bind another action than the one the page asked for: the revocation of another session. */
    mismatchNextStepUp: false,
    keys: EXISTING_KEY_NAMES.map(
      (name, i): KeyRecord => ({ id: randomUUID(), name, createdAt: iso(now - (30 + i) * 24 * HOUR), lastUsedAt: i === 0 ? iso(now - 2 * HOUR) : null, credentialId: null }),
    ),
    sessions: new Map<string, SessionRecord>(),
    audit: auditLog(now),
    /** Challenges handed out and not yet spent, by their base64url text: what each was issued for. */
    challenges: new Map<string, { purpose: "register" | "signin" | "step_up"; target?: string }>(),
    /** The handles the page revoked with its key. */
    revoked: [] as string[],
    stepUpOptionsServed: 0,
    requests: [] as RequestRecord[],
    problems: [] as string[],
  };
  // Two other live sessions of the person's, started earlier from other browsers and used minutes ago: one to revoke, one
  // for the mismatched step-up.
  for (const [i, browser] of OTHER_BROWSERS.entries()) {
    const handle = randomUUID();
    state.sessions.set(handle, { handle, token: b64url(32), csrf: b64url(32), browser, createdAt: now - (3 + i) * HOUR, lastUsedAt: now - (2 + 3 * i) * 60_000, credentialId: null });
  }

  const problem = (text: string) => state.problems.push(text);

  /** A ceremony's client data: its type, a challenge this server issued for `purpose` (spent here), and the page's origin. */
  function clientData(encoded: string, type: "webauthn.create" | "webauthn.get", purpose: "register" | "signin" | "step_up", refusal: string) {
    let data: { type?: unknown; challenge?: unknown; origin?: unknown };
    try {
      data = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      problem(`${type}: client data that is not JSON`);
      throw new Refusal(400, refusal);
    }
    const issued = typeof data.challenge === "string" ? state.challenges.get(data.challenge) : undefined;
    if (data.type !== type || data.origin !== state.origin || issued?.purpose !== purpose) {
      problem(`${type}: client data for ${String(data.type)} at ${String(data.origin)}, challenge ${issued ? issued.purpose : "unknown"}`);
      throw new Refusal(400, refusal);
    }
    state.challenges.delete(data.challenge as string);
    return issued;
  }

  /** The session the staff cookie names, as requireStaff reads it: never cached, refused with both cookies cleared. */
  function requireStaff(req: IncomingMessage): SessionRecord {
    const jar = cookies(req);
    const session = [...state.sessions.values()].find((s) => s.token === jar.get(SESSION_COOKIE));
    const at = Date.now();
    if (!session || at >= session.createdAt + ABSOLUTE_MS || at >= session.lastUsedAt + IDLE_MS) throw new Refusal(401, "staff_session_required", { "set-cookie": CLEAR_COOKIES });
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-staff-csrf"] !== jar.get(CSRF_COOKIE)) {
      problem(`${req.method} ${req.url}: the staff CSRF header does not echo the staff CSRF cookie`);
      throw new Refusal(403, "csrf_failed");
    }
    // Only a request its person's action started moves the idle end.
    if (req.headers["x-staff-activity"] === "1") session.lastUsedAt = at;
    return session;
  }

  function me(session: SessionRecord): StaffMe {
    const at = Date.now();
    const absoluteEnd = session.createdAt + ABSOLUTE_MS;
    const idleEnd = Math.min(session.lastUsedAt + IDLE_MS, absoluteEnd);
    return {
      handle: PERSON_HANDLE,
      role: "moderator",
      sessionHandle: session.handle,
      idleExpiresAt: iso(idleEnd),
      idleSecondsLeft: Math.max(0, Math.floor((idleEnd - at) / 1000)),
      absoluteExpiresAt: iso(absoluteEnd),
      absoluteSecondsLeft: Math.max(0, Math.floor((absoluteEnd - at) / 1000)),
    };
  }

  function auditPage(query: URLSearchParams): AuditPage {
    const action = query.get("action");
    const cursor = query.get("cursor");
    const at = query.get("at");
    let rows = action === null ? state.audit : state.audit.filter((row) => row.action === action);
    if (cursor !== null) rows = rows.filter((row) => row.seq < Number(cursor));
    if (at !== null) rows = rows.filter((row) => row.seq <= Number(at));
    const entries = rows.slice(0, STAFF_AUDIT_PAGE_SIZE);
    return { entries, nextCursor: rows.length > entries.length ? entries[entries.length - 1]!.seq : null };
  }

  /** A step-up challenge in the contracts' layout; its seal is random, since only this server reads it back. */
  async function stepUpChallenge(sessionHandle: string, action: StaffStepUpActionInput): Promise<string> {
    const layout = STAFF_STEP_UP_CHALLENGE;
    const bytes = randomBytes(layout.bytes);
    bytes[layout.versionAt] = layout.version;
    bytes[layout.purposeAt] = layout.purpose;
    bytes.writeBigUInt64BE(BigInt(Date.now() + 10 * 60_000), layout.expiryAt);
    Buffer.from(await stepUpBinding(sessionHandle, await stepUpActionHash(action))).copy(bytes, layout.bindingAt);
    return bytes.toString("base64url");
  }

  function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      problem(`${what}: a body the contracts refuse`);
      throw new Refusal(400, "invalid_request");
    }
    return parsed.data;
  }

  /** One staff route's answer. */
  async function route(req: IncomingMessage, url: URL, body: unknown): Promise<Answer> {
    const key = `${req.method} ${url.pathname}`;

    if (key === "POST /api/staff/enroll/options") {
      const input = parse(StaffEnrollOptionsRequest, body, key);
      if (input.token !== state.enrolmentToken || state.enrolmentUsed) throw new Refusal(400, "staff_enrollment_invalid");
      const challenge = b64url(58);
      state.challenges.set(challenge, { purpose: "register" });
      const securityKey = input.kind === "security_key";
      // As @simplewebauthn/server 14.0.2 writes them for the console: the security-key hint only with cross-platform attachment.
      const options = {
        challenge,
        rp: { id: "localhost", name: "korbat" },
        user: { id: userHandle, name: input.name, displayName: input.name },
        pubKeyCredParams: [-8, -7, -257].map((alg) => ({ alg, type: "public-key" })),
        timeout: 300_000,
        attestation: "none",
        excludeCredentials: state.keys.filter((k) => k.credentialId !== null).map((k) => ({ id: k.credentialId, type: "public-key" })),
        authenticatorSelection: { residentKey: "required", userVerification: "required", requireResidentKey: true, ...(securityKey ? { authenticatorAttachment: "cross-platform" } : {}) },
        extensions: { credProps: true },
        ...(securityKey ? { hints: ["security-key"] } : {}),
      };
      // As in production, the console's relying party ID is not the app's, so the page may signal a refused key.
      return { status: 200, body: { options, rpShared: false } };
    }

    if (key === "POST /api/staff/enroll/verify") {
      const input = parse(StaffEnrollVerifyRequest, body, key);
      if (input.token !== state.enrolmentToken || state.enrolmentUsed) throw new Refusal(400, "staff_enrollment_invalid");
      clientData(input.response.response.clientDataJSON, "webauthn.create", "register", "staff_key_refused");
      const refusal = flagRefusal(flagsOf(authDataOf(Buffer.from(input.response.response.attestationObject, "base64url"))));
      // A refusal leaves the link usable, so the person can try another key.
      if (refusal) throw new Refusal(400, refusal);
      state.enrolmentUsed = true;
      const stored: KeyRecord = { id: randomUUID(), name: input.name, createdAt: iso(Date.now()), lastUsedAt: null, credentialId: input.response.id };
      state.keys.push(stored);
      return { status: 200, body: { key: { id: stored.id, name: stored.name, createdAt: stored.createdAt, lastUsedAt: stored.lastUsedAt } } };
    }

    if (key === "POST /api/staff/signin/options") {
      if (body !== undefined) problem(`${key}: a body, where the route takes none`);
      const challenge = b64url(58);
      state.challenges.set(challenge, { purpose: "signin" });
      return { status: 200, body: { options: { challenge, rpId: "localhost", timeout: 300_000, userVerification: "required", allowCredentials: [] } } };
    }

    if (key === "POST /api/staff/signin/verify") {
      const input = parse(StaffSignInVerifyRequest, body, key);
      clientData(input.response.response.clientDataJSON, "webauthn.get", "signin", "staff_key_invalid");
      const staffKey = state.keys.find((k) => k.credentialId !== null && k.credentialId === input.response.id);
      if (!staffKey || input.response.response.userHandle !== userHandle) throw new Refusal(400, "staff_key_invalid");
      const refusal = flagRefusal(flagsOf(Buffer.from(input.response.response.authenticatorData, "base64url")));
      if (refusal) throw new Refusal(400, refusal);
      staffKey.lastUsedAt = iso(Date.now());
      const session: SessionRecord = {
        handle: randomUUID(),
        token: b64url(32),
        csrf: b64url(32),
        browser: CURRENT_BROWSER,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        credentialId: staffKey.credentialId,
      };
      state.sessions.set(session.handle, session);
      const setCookies = [`${SESSION_COOKIE}=${session.token}; ${COOKIE}; HttpOnly; Max-Age=43200`, `${CSRF_COOKIE}=${session.csrf}; ${COOKIE}; Max-Age=43200`];
      return { status: 200, body: me(session), headers: { "set-cookie": setCookies } };
    }

    // Everything below needs a staff session.
    const routes = new Set(["GET /api/staff/me", "GET /api/staff/sessions", "GET /api/staff/keys", "GET /api/staff/audit", "POST /api/staff/signout", "POST /api/staff/step-up/options"]);
    const revoke = req.method === "DELETE" && /^\/api\/staff\/sessions\/[^/]+$/.test(url.pathname);
    if (!routes.has(key) && !revoke) throw new Refusal(404, "not_found");
    const session = requireStaff(req);

    if (key === "GET /api/staff/me") return { status: 200, body: me(session) };
    if (key === "GET /api/staff/sessions") {
      const sessions: StaffSession[] = [...state.sessions.values()].map((s) => ({
        handle: s.handle,
        browser: s.browser,
        createdAt: iso(s.createdAt),
        lastUsedAt: iso(s.lastUsedAt),
        current: s === session,
      }));
      return { status: 200, body: { sessions } };
    }
    if (key === "GET /api/staff/keys") return { status: 200, body: { keys: state.keys.map((k): StaffKey => ({ id: k.id, name: k.name, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })) } };
    if (key === "GET /api/staff/audit") return { status: 200, body: auditPage(url.searchParams) };
    if (key === "POST /api/staff/signout") {
      state.sessions.delete(session.handle);
      return { status: 204, headers: { "set-cookie": CLEAR_COOKIES } };
    }
    if (key === "POST /api/staff/step-up/options") {
      const action = parse(StaffStepUpOptionsRequest, body, key);
      if (!state.sessions.has(action.target.id)) throw new Refusal(404, "not_found");
      state.stepUpOptionsServed += 1;
      // The mismatched case: an API that asks the key to confirm the revocation of this very session instead of the one chosen.
      const bound = state.mismatchNextStepUp ? { ...action, target: { ...action.target, id: session.handle } } : action;
      state.mismatchNextStepUp = false;
      const challenge = await stepUpChallenge(session.handle, bound);
      state.challenges.set(challenge, { purpose: "step_up", target: bound.target.id });
      const allow = session.credentialId === null ? [] : [{ id: session.credentialId, type: "public-key", transports: ["usb"] }];
      return { status: 200, body: { options: { challenge, rpId: "localhost", timeout: 300_000, userVerification: "required", allowCredentials: allow } } };
    }

    // DELETE /api/staff/sessions/:handle, confirmed by the session's own key for exactly this session.
    const handle = decodeURIComponent(url.pathname.slice("/api/staff/sessions/".length));
    const { stepUp } = parse(StaffSessionRevokeRequest, body, "DELETE /api/staff/sessions/:handle");
    const issued = clientData(stepUp.response.clientDataJSON, "webauthn.get", "step_up", "staff_step_up_invalid");
    if (issued.target !== handle || stepUp.id !== session.credentialId) {
      problem(`DELETE ${handle}: an assertion for ${String(issued.target)} from ${stepUp.id}`);
      throw new Refusal(400, "staff_step_up_invalid");
    }
    const refusal = flagRefusal(flagsOf(Buffer.from(stepUp.response.authenticatorData, "base64url")));
    if (refusal) throw new Refusal(400, refusal === "staff_key_refused" ? "staff_step_up_invalid" : refusal);
    if (!state.sessions.delete(handle)) throw new Refusal(404, "not_found");
    state.revoked.push(handle);
    return { status: 204 };
  }

  /** The staff gate: the console's Host, an Origin on every write and never another, and same-origin fetch metadata. */
  function gate(req: IncomingMessage) {
    if (req.headers.host !== new URL(state.origin).host) {
      problem(`${req.method} ${req.url}: Host ${String(req.headers.host)}`);
      throw new Refusal(404, "not_found");
    }
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin") {
      problem(`${req.method} ${req.url}: Sec-Fetch-Site ${site}`);
      throw new Refusal(403, "csrf_failed");
    }
    const origin = req.headers.origin;
    if ((origin !== undefined || (req.method !== "GET" && req.method !== "HEAD")) && origin !== state.origin) {
      problem(`${req.method} ${req.url}: Origin ${String(origin)}`);
      throw new Refusal(403, "csrf_failed");
    }
  }

  /** Answers one request under /api/staff, as the API behind Caddy's console site would. */
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL, raw: Buffer): Promise<void> {
    let answer: Answer;
    try {
      if (state.off) throw new Refusal(404, "not_found");
      gate(req);
      let body: unknown;
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          problem(`${req.method} ${url.pathname}: a body that is not JSON`);
          throw new Refusal(400, "invalid_request");
        }
      }
      answer = await route(req, url, body);
    } catch (err) {
      if (!(err instanceof Refusal)) throw err;
      answer = { status: err.status, body: { error: { code: err.code, message: "the fixture's own words" } }, headers: err.headers };
    }
    state.requests.push({ method: req.method ?? "", path: `${url.pathname}${url.search}`, status: answer.status, activity: req.headers["x-staff-activity"] === "1" });
    const headers: Record<string, string | string[]> = { "cache-control": "no-store", ...answer.headers };
    if (answer.body === undefined) {
      res.writeHead(answer.status, headers);
      res.end();
      return;
    }
    res.writeHead(answer.status, { ...headers, "content-type": "application/json" });
    res.end(JSON.stringify(answer.body));
  }

  return {
    state,
    handle,
    /** Every staff session ends behind the page's back, as a revocation from the command line ends them. */
    endEverySession() {
      state.sessions.clear();
    },
  };
}
```

### Create `apps/admin/test/browser/server.ts`

```ts
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { CONSOLE_SITE, consoleSiteHeadersFromCaddyfile, lines, readCaddyfile, routeFor, site } from "../caddyfile";

/**
 * Caddy's console site as the browser check needs it (3a design, sections 8 and 12), in a small Node server that takes
 * its routes and headers from infra/caddy/Caddyfile: a path the site proxies to the API goes to the fixture API, a path it
 * answers itself gets that answer, and everything else is a file of the build, with index.html for a path that names
 * none (try_files), sent with the headers the console site sets for the path asked for. The page is opened at
 * http://localhost:<port>, never 127.0.0.1, since browsers refuse WebAuthn on an IP address.
 */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** The largest body the console site lets through to the staff API (request_body max_size 64KB; Caddy's KB is 1000 bytes). */
const BODY_LIMIT = 64 * 1000;

export interface ConsoleSiteServer {
  origin: string;
  close(): Promise<void>;
}

/** Hands one request under the staff API to the fixtures, with its body read. */
export type ApiHandler = (req: IncomingMessage, res: ServerResponse, url: URL, body: Buffer) => Promise<void>;

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= BODY_LIMIT) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > BODY_LIMIT ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** The file a path names inside `dist`, or null: decoded once, and never outside the folder. */
async function fileFor(dist: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.resolve(dist, `.${path.posix.normalize(decoded)}`);
  if (!file.startsWith(dist + path.sep)) return null;
  const info = await stat(file).catch(() => null);
  return info?.isFile() ? file : null;
}

/**
 * What a handle that answers by itself sends: its `respond <body> <status>` and the `header Name value` lines beside it.
 * Null for a handle that does not answer by itself.
 */
function ownAnswer(block: ReturnType<typeof routeFor>["block"]): { status: number; body: string; headers: Record<string, string> } | null {
  const respond = block.children?.find((node) => node.tokens[0] === "respond");
  if (!respond) return null;
  const headers: Record<string, string> = {};
  for (const line of lines(block)) {
    const [directive, name, value, ...rest] = line.split(" ");
    if (directive === "header" && name !== undefined && value !== undefined && rest.length === 0 && !name.startsWith("-")) headers[name] = value;
  }
  return { status: Number(respond.tokens[2]), body: respond.tokens[1] ?? "", headers };
}

export async function startConsoleSite(options: { dist: string; api: ApiHandler }): Promise<ConsoleSiteServer> {
  const dist = path.resolve(options.dist);
  const consoleSite = site(readCaddyfile(), CONSOLE_SITE);
  const headersFor = consoleSiteHeadersFromCaddyfile();
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const handle = routeFor(consoleSite, url.pathname);

      // The staff API: the handle that proxies to api:3000.
      if (handle.block.children?.some((node) => node.tokens[0] === "reverse_proxy")) {
        const body = await readBody(req);
        if (body === null) {
          res.writeHead(413).end();
          return;
        }
        await options.api(req, res, url, body);
        return;
      }

      // Any other API path: the site's own answer.
      const own = ownAnswer(handle.block);
      if (own) {
        res.writeHead(own.status, own.headers).end(own.body);
        return;
      }

      // The console's files. file_server answers only GET and HEAD.
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      const named = await fileFor(dist, url.pathname);
      const file = named ?? path.join(dist, "index.html");
      const info = await stat(file);
      // Caddy matches the header lines on the path asked for, before try_files picks the file; its file matcher holds
      // when that path names a file of the build.
      res.writeHead(200, { ...headersFor(url.pathname, named !== null), "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-length": info.size });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(file).pipe(res);
    })().catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://localhost:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
```

### Create `apps/admin/test/browser/watch.ts`

```ts
import type { BrowserContext, CDPSession, Page } from "playwright-core";

/**
 * Every channel a policy report, a page error or a dialog can reach the check by (console-lab.md, section 2), watched for
 * the whole walk: the page's own securitypolicyviolation events, from a listener installed before any of the page's
 * scripts runs; any Trusted Types policy the page tries to create; Chromium's console, through Playwright and through the
 * CDP Log domain, whose source is "security" for CSP and Trusted Types messages; DevTools issues (the Audits domain), which
 * classify every CSP issue; page errors; dialogs, dismissed; failed requests; and any request that would leave the
 * console's origin, aborted. Everything found is a problem, listed with what it said.
 */

/**
 * Console errors the walk causes on purpose, which Chromium logs for every answer that is not a success: 400 (a refused
 * key at enrolment), 401 (no session, an ended session) and 404 (the console off). What the page then shows is checked
 * step by step, and a request the fixtures refuse for the page's own fault is one of their problems.
 */
const EXPECTED_HTTP_ERROR = /^Failed to load resource: the server responded with a status of (400|401|404) /;
const POLICY_TEXT = /Content.Security.Policy|Trusted.?Type|require-trusted-types-for|Refused to/i;

/**
 * Runs in every page before its own scripts, outside its policy (Playwright adds it through CDP). It is plain text, so no
 * test runner's transform can put a helper into it that the page does not have. It reports through the binding below.
 */
const INIT_SCRIPT = `
(() => {
  const report = (kind, detail) => window.__korbatReport(kind, detail);
  document.addEventListener("securitypolicyviolation", (event) => {
    report("securitypolicyviolation", JSON.stringify({
      directive: event.effectiveDirective,
      blocked: event.blockedURI,
      sample: event.sample,
      source: event.sourceFile,
      line: event.lineNumber,
      disposition: event.disposition,
    }));
  }, true);
  // trusted-types 'none' already refuses every policy; this names any the page tries, should the header ever change.
  const factory = window.trustedTypes;
  if (factory && typeof factory.createPolicy === "function") {
    const create = factory.createPolicy.bind(factory);
    factory.createPolicy = (name, rules) => {
      report("a Trusted Types policy created", String(name));
      return create(name, rules);
    };
  }
})();
`;

export interface Watcher {
  /** The page's CDP session, which the walk also drives the virtual authenticator with. */
  cdp: CDPSession;
  /** The problems found since the last call, which it clears. */
  take(): string[];
}

export async function watch(context: BrowserContext, page: Page, origin: string): Promise<Watcher> {
  let problems: string[] = [];
  const found = (text: string) => problems.push(text);

  // The binding is Playwright's, added through CDP, so the page's policy does not apply to it.
  await context.exposeBinding("__korbatReport", (_source, kind: string, detail: string) => found(`${kind}: ${detail}`));
  await context.addInitScript({ content: INIT_SCRIPT });

  const cdp = await context.newCDPSession(page);
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (entry.source === "security" || POLICY_TEXT.test(entry.text)) found(`console (CDP Log, ${entry.source}, ${entry.level}): ${entry.text}`);
    else if ((entry.level === "error" || entry.level === "warning") && !EXPECTED_HTTP_ERROR.test(entry.text)) found(`console (CDP Log, ${entry.source}, ${entry.level}): ${entry.text}`);
  });
  await cdp.send("Log.enable");
  cdp.on("Audits.issueAdded", ({ issue }) => {
    if (issue.code === "ContentSecurityPolicyIssue") found(`DevTools CSP issue: ${JSON.stringify(issue.details.contentSecurityPolicyIssueDetails)}`);
  });
  await cdp.send("Audits.enable");

  page.on("console", (message) => {
    const text = message.text();
    if (POLICY_TEXT.test(text)) found(`console ${message.type()}: ${text}`);
    else if ((message.type() === "error" || message.type() === "warning") && !EXPECTED_HTTP_ERROR.test(text)) found(`console ${message.type()}: ${text}`);
  });
  page.on("pageerror", (error) => found(`page error: ${error.message}`));
  page.on("dialog", (dialog) => {
    found(`dialog (${dialog.type()}): ${dialog.message()}`);
    void dialog.dismiss().catch(() => undefined);
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "no reason";
    void request.response().then((response) => {
      // Chromium reports a 204 answer as aborted once it has arrived, since there is no body to read (the console's
      // sign-out and revocation). The answer did arrive; a request the policy blocks never gets one.
      if (reason === "net::ERR_ABORTED" && response?.status() === 204) return;
      found(`request failed: ${request.method()} ${request.url()} (${reason})`);
    });
  });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (new URL(url).origin === origin) return route.continue();
    found(`a request to another origin, aborted: ${url}`);
    return route.abort();
  });

  return {
    cdp,
    take() {
      const taken = problems;
      problems = [];
      return taken;
    },
  };
}

/**
 * What the page holds that the console never writes: an element that runs or loads something, an inline handler or
 * style, a link that is not one of the console's own paths, a form with an action, or a script other than the bundle.
 * Plain text, evaluated in the page, for the reason INIT_SCRIPT is.
 */
const INSPECT_SCRIPT = `
(() => {
  const out = [];
  const root = document.getElementById("root");
  if (!root) return ["the page has no #root"];
  for (const element of root.querySelectorAll("script, style, link, meta, base, iframe, frame, object, embed, img, svg, math, template, video, audio, source")) {
    out.push("a <" + element.tagName.toLowerCase() + "> element");
  }
  for (const element of root.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      if (name.toLowerCase().startsWith("on") || name === "srcdoc" || name === "style" || name === "src") out.push("a " + name + " attribute on <" + element.tagName.toLowerCase() + ">");
    }
  }
  for (const link of root.querySelectorAll("a")) {
    const href = link.getAttribute("href");
    if (href !== "/" && href !== "/audit" && href !== "/signin") out.push("a link to " + String(href));
  }
  for (const form of root.querySelectorAll("form")) {
    if (form.hasAttribute("action")) out.push("a form with an action: " + String(form.getAttribute("action")));
  }
  if (document.scripts.length !== 1) out.push(document.scripts.length + " script elements");
  return out;
})()
`;

export function inspect(page: Page): Promise<string[]> {
  return page.evaluate(INSPECT_SCRIPT) as Promise<string[]>;
}

/** The text of every element holding a string a person wrote (UserText's <bdi>) and of every <code> (actions, targets, hashes). */
export function userTexts(page: Page): Promise<string[]> {
  return page.evaluate(`[...document.querySelectorAll("bdi, code")].map((element) => element.textContent ?? "")`) as Promise<string[]>;
}
```

### Create `apps/admin/test/caddyfile.ts`

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A reader for infra/caddy/Caddyfile, just large enough for what it holds (3a design, sections 8 and 12): sites, snippets,
 * handle blocks with path matchers, and header lines. The console's tests read the console site from it, never from a
 * copy: the source scan compares its headers with site-headers.mjs, which the development server sends, and the browser
 * check serves the console with them, so the page is tested under the policy Caddy really sends.
 */
export const CADDYFILE = path.resolve(import.meta.dirname, "..", "..", "..", "infra", "caddy", "Caddyfile");

/** The two sites, by the port they listen on in the container. */
export const APP_SITE = ":8080";
export const CONSOLE_SITE = ":8090";

/** One line of the Caddyfile as tokens, and the lines of its block when it opens one. */
export interface CaddyNode {
  tokens: string[];
  children?: CaddyNode[];
}

/** A line's tokens: words, and "double-quoted" or `backtick-quoted` strings without their quotes; a # starting a token ends the line. */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    const char = line[i]!;
    if (char === " " || char === "\t") {
      i++;
      continue;
    }
    if (char === "#") break;
    if (char === '"' || char === "`") {
      const end = line.indexOf(char, i + 1);
      if (end === -1) throw new Error(`an unclosed quote in the Caddyfile: ${line.trim()}`);
      tokens.push(line.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    let end = i;
    while (end < line.length && line[end] !== " " && line[end] !== "\t") end++;
    tokens.push(line.slice(i, end));
    i = end;
  }
  return tokens;
}

/** The text as a tree of lines: a line ending in { opens a block, a lone } closes it. */
function parseTree(text: string): CaddyNode[] {
  const root: CaddyNode[] = [];
  const stack: CaddyNode[][] = [root];
  for (const line of text.split(/\r?\n/)) {
    const tokens = tokenize(line);
    if (tokens.length === 0) continue;
    const top = stack[stack.length - 1]!;
    if (tokens.length === 1 && tokens[0] === "}") {
      if (stack.length === 1) throw new Error("the Caddyfile closes a block it never opened");
      stack.pop();
      continue;
    }
    if (tokens[tokens.length - 1] === "{") {
      const node: CaddyNode = { tokens: tokens.slice(0, -1), children: [] };
      top.push(node);
      stack.push(node.children!);
      continue;
    }
    top.push({ tokens });
  }
  if (stack.length !== 1) throw new Error("the Caddyfile leaves a block open");
  return root;
}

/** Each `import <snippet>` line replaced by the snippet's lines, as Caddy does; an import of a file stays a line. */
function expand(nodes: CaddyNode[], snippets: Map<string, CaddyNode[]>, depth = 0): CaddyNode[] {
  if (depth > 10) throw new Error("the Caddyfile's snippets import each other in a loop");
  return nodes.flatMap((node) => {
    if (node.tokens[0] === "import" && node.tokens.length === 2 && node.children === undefined && snippets.has(node.tokens[1]!)) {
      return expand(snippets.get(node.tokens[1]!)!, snippets, depth + 1);
    }
    return [node.children === undefined ? node : { tokens: node.tokens, children: expand(node.children, snippets, depth) }];
  });
}

/**
 * The Caddyfile as Caddy sees it: the global options block and the sites, with every snippet (a top-level `(name)` block)
 * imported where it is named and dropped from the top level.
 */
export function parseCaddyfile(text: string): CaddyNode[] {
  const tree = parseTree(text);
  const snippets = new Map<string, CaddyNode[]>();
  for (const node of tree) {
    const name = /^\((.+)\)$/.exec(node.tokens[0] ?? "")?.[1];
    if (name !== undefined && node.children !== undefined && node.tokens.length === 1) snippets.set(name, node.children);
  }
  return expand(
    tree.filter((node) => !/^\(.+\)$/.test(node.tokens[0] ?? "")),
    snippets,
  );
}

export function readCaddyfile(): CaddyNode[] {
  return parseCaddyfile(readFileSync(CADDYFILE, "utf8"));
}

/** The site block for an address such as :8090. */
export function site(tree: CaddyNode[], address: string): CaddyNode {
  const found = tree.filter((node) => node.children !== undefined && node.tokens.length === 1 && node.tokens[0] === address);
  if (found.length !== 1) throw new Error(`the Caddyfile has ${found.length} sites ${address}, not one`);
  return found[0]!;
}

/**
 * What a matcher matches: one of its paths and, with `file`, only when the path names a file under the site's root (Caddy's
 * file matcher without arguments); `not` negates the whole. Null in a map of matchers when it is none this reader knows.
 */
export interface PathMatcher {
  paths: string[];
  file: boolean;
  not: boolean;
}

/** The conditions of one matcher, `path ...` with an optional `file`, as lines of tokens; null when they are anything else. */
function conditions(lines: string[][]): { paths: string[]; file: boolean } | null {
  const paths = lines.filter((tokens) => tokens[0] === "path");
  const file = lines.filter((tokens) => tokens.length === 1 && tokens[0] === "file");
  if (paths.length !== 1 || file.length > 1 || paths.length + file.length !== lines.length) return null;
  return { paths: paths[0]!.slice(1), file: file.length === 1 };
}

/**
 * Every named matcher of a block, by name: `@name path ...`, or a block holding `path ...` and optionally `file`, or one
 * `not path ...` line, or one `not { ... }` block of those.
 */
export function pathMatchers(block: CaddyNode): Map<string, PathMatcher | null> {
  const matchers = new Map<string, PathMatcher | null>();
  for (const node of block.children ?? []) {
    const name = node.tokens[0];
    if (!name?.startsWith("@")) continue;
    let matcher: PathMatcher | null = null;
    if (node.children === undefined) {
      const found = conditions([node.tokens.slice(1)]);
      matcher = found && { ...found, not: false };
    } else if (node.children.length === 1 && node.children[0]!.tokens[0] === "not") {
      const not = node.children[0]!;
      const found = not.children === undefined ? conditions([not.tokens.slice(1)]) : not.tokens.length === 1 ? conditions(not.children.map((child) => child.tokens)) : null;
      matcher = found && { ...found, not: true };
    } else {
      const found = conditions(node.children.map((child) => child.tokens));
      matcher = found && { ...found, not: false };
    }
    matchers.set(name, matcher);
  }
  return matchers;
}

/** Caddy's path matching as this Caddyfile uses it: a trailing * matches any rest, otherwise the path must be equal. */
export function pathMatches(pattern: string, pathname: string): boolean {
  if (pattern.endsWith("*")) return pathname.startsWith(pattern.slice(0, -1));
  return pathname === pattern;
}

/**
 * Whether a matcher takes a request for `pathname`, where `isFile` says whether the path names a file under the site's
 * root (only a matcher with `file` asks). No matcher takes every request.
 */
export function matcherTakes(matcher: PathMatcher | null | undefined, pathname: string, isFile = false): boolean {
  if (matcher === undefined) return true;
  if (matcher === null) throw new Error("a matcher this reader cannot evaluate");
  const inner = matcher.paths.some((pattern) => pathMatches(pattern, pathname)) && (!matcher.file || isFile);
  return matcher.not ? !inner : inner;
}

/** One handle block of a site: its matcher token as written (an inline path, an @name, or none), what it matches, and its lines. */
export interface Handle {
  matcher: string | null;
  match: PathMatcher | undefined;
  block: CaddyNode;
}

/** A site's handle blocks in the order they are written. */
export function handles(siteBlock: CaddyNode): Handle[] {
  const named = pathMatchers(siteBlock);
  return (siteBlock.children ?? [])
    .filter((node) => node.tokens[0] === "handle" && node.children !== undefined)
    .map((block) => {
      const matcher = block.tokens[1] ?? null;
      if (matcher === null) return { matcher, match: undefined, block };
      if (matcher.startsWith("@")) {
        const match = named.get(matcher);
        if (!match) throw new Error(`the handle's matcher ${matcher} is not a path matcher this reader knows`);
        return { matcher, match, block };
      }
      // An inline matcher: the paths written after the directive's name.
      return { matcher, match: { paths: block.tokens.slice(1), file: false, not: false }, block };
    });
}

/**
 * Caddy's order for same-named directives (caddyconfig/httpcaddyfile/directives.go, sortRoutes), which decides which
 * handle a request reaches. Two directives that each match exactly one path go most specific first: the longer path,
 * trailing * left out (the shorter one when the two differ only by it). Otherwise one with a matcher goes before one
 * without, and two with matchers keep the order they are written in. Caddy runs Go's stable sort with that comparison,
 * which for a site's few handles is an insertion sort, so it is one here too: the comparison is not transitive when single
 * and multi-path matchers are mixed, and only the same steps give the same order (the test of this reader pins one such
 * order that `caddy adapt` gave on Caddy 2.11.4).
 */
export function caddyOrder(list: Handle[]): Handle[] {
  // Caddy compares the path of a handle whose one matcher set holds one path; a negated or file matcher is not that.
  const single = (h: Handle) => (h.match !== undefined && !h.match.not && !h.match.file && h.match.paths.length === 1 ? h.match.paths[0]! : null);
  const less = (i: Handle, j: Handle): boolean => {
    const a = single(i);
    const b = single(j);
    if (a !== null && b !== null) {
      const at = a.endsWith("*") ? a.slice(0, -1) : a;
      const bt = b.endsWith("*") ? b.slice(0, -1) : b;
      if (at === bt) return a.length < b.length;
      if (at.length === bt.length) return at < bt;
      return at.length > bt.length;
    }
    return i.matcher !== null && j.matcher === null;
  };
  const out = [...list];
  for (let i = 1; i < out.length; i++) {
    for (let j = i; j > 0 && less(out[j]!, out[j - 1]!); j--) [out[j], out[j - 1]] = [out[j - 1]!, out[j]!];
  }
  return out;
}

/** The handle of a site that a request for `pathname` reaches: the first in Caddy's order whose matcher takes it. */
export function routeFor(siteBlock: CaddyNode, pathname: string): Handle {
  const found = caddyOrder(handles(siteBlock)).find((h) => matcherTakes(h.match, pathname));
  if (!found) throw new Error(`no handle of the site takes ${pathname}`);
  return found;
}

/** Every line of a block, its own and its children's, as text, tokens joined by one space. */
export function lines(node: CaddyNode): string[] {
  return (node.children ?? []).flatMap((child) => [child.tokens.join(" "), ...lines(child)]);
}

/**
 * The response headers the console site sets on a static answer to `pathname`: the `header` block of its handle without a
 * matcher (the static files), and each `header @matcher Name value` line whose matcher takes the request's path, which is
 * what Caddy matches on (the header directive runs before try_files). `isFile` says whether the path names a file of the
 * build, for a matcher with `file`. Deletions such as -Server set nothing.
 */
export function consoleSiteHeadersFromCaddyfile(tree: CaddyNode[] = readCaddyfile()): (pathname: string, isFile: boolean) => Record<string, string> {
  const statics = handles(site(tree, CONSOLE_SITE)).filter((h) => h.matcher === null);
  if (statics.length !== 1) throw new Error(`the console site needs exactly one handle without a matcher, the static files; it has ${statics.length}`);
  const block = statics[0]!.block;
  const matchers = pathMatchers(block);
  const always: Record<string, string> = {};
  const conditional: { matcher: PathMatcher; name: string; value: string }[] = [];
  const unknown = (node: CaddyNode) => new Error(`a header line the reader does not know: ${node.tokens.join(" ")}`);
  for (const node of block.children ?? []) {
    if (node.tokens[0] !== "header") continue;
    if (node.children !== undefined) {
      if (node.tokens.length !== 1) throw unknown(node);
      for (const field of node.children) {
        const [name, value, ...rest] = field.tokens;
        if (name === undefined || (name.startsWith("-") && value === undefined)) continue;
        if (value === undefined || rest.length > 0 || name.startsWith("-") || name.startsWith("+") || name.startsWith("?")) throw unknown(field);
        always[name] = value;
      }
      continue;
    }
    const [, first, second, third, ...rest] = node.tokens;
    if (first?.startsWith("@")) {
      const matcher = matchers.get(first);
      if (!matcher || second === undefined || third === undefined || rest.length > 0) throw unknown(node);
      conditional.push({ matcher, name: second, value: third });
    } else if (first !== undefined && !(first.startsWith("-") && second === undefined)) {
      if (second === undefined || third !== undefined) throw unknown(node);
      always[first] = second;
    }
  }
  return (pathname, isFile) => {
    const headers = { ...always };
    for (const { matcher, name, value } of conditional) if (matcherTakes(matcher, pathname, isFile)) headers[name] = value;
    return headers;
  };
}
```

### Create `apps/admin/test/console-site.test.ts`

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDevServer } from "../dev-server.mjs";
import { CONSOLE_CSP, consoleSiteHeaders, isHashedPath } from "../site-headers.mjs";
import {
  APP_SITE,
  caddyOrder,
  CONSOLE_SITE,
  consoleSiteHeadersFromCaddyfile,
  handles,
  lines,
  matcherTakes,
  parseCaddyfile,
  pathMatchers,
  readCaddyfile,
  routeFor,
  site,
  type CaddyNode,
  type Handle,
} from "./caddyfile";

/**
 * Caddy's console site (3a design, sections 8 and 13, Task 7) against the console's own definition of its headers,
 * site-headers.mjs, which the development server sends: the two cannot drift, so the console runs locally under the policy
 * it runs under in production. Also the console site's routes, the app site's refusal of the staff API, and how the image,
 * Compose and infra/.env.example carry the console.
 */
const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(REPO, ...parts), "utf8");

/** The paths the page, the router's addresses, the icon and the hashed files are asked for at, and a hashed name the build does not hold. */
const PATHS = ["/", "/index.html", "/signin", "/audit", "/enroll/abc", "/no/such/page", "/favicon.svg", "/assets/main-ABCDEFGH.js", "/assets/main-ABCDEFGH.css", "/assets/main-MISSING0.js"];
/** Those of the paths that name a file of the build; every other is answered with index.html. */
const FILES = new Set(["/index.html", "/favicon.svg", "/assets/main-ABCDEFGH.js", "/assets/main-ABCDEFGH.css"]);
/**
 * The headers site-headers.mjs gives the answer to `p`, as the development server asks for them: for the path itself when
 * it names a file, and for the page ("/") when index.html is answered in its place.
 */
const devHeaders = (p: string) => consoleSiteHeaders(FILES.has(p) ? p : "/");

/** The answer of a handle that refuses a path: Caddy's own 404 in the API's error envelope, never a proxy. */
function expectRefusal(handle: Handle) {
  const block = lines(handle.block);
  const respond = handle.block.children?.find((node) => node.tokens[0] === "respond");
  expect(respond?.tokens.length, block.join(" | ")).toBe(3);
  expect(respond!.tokens[2]).toBe("404");
  expect(JSON.parse(respond!.tokens[1]!)).toEqual({ error: { code: "not_found", message: "No such route" } });
  expect(block).toContain("header Content-Type application/json");
  expect(block).toContain("header Cache-Control no-store");
  expect(block).toContain("header -Server");
  expect(block.some((line) => line.startsWith("reverse_proxy"))).toBe(false);
}

describe("the reader of the Caddyfile", () => {
  test("reads blocks, quoted values, matchers and snippets, and drops comments", () => {
    const tree = parseCaddyfile(
      [
        "(refuse) {",
        "  respond `{\"a\": 1}` 404",
        "}",
        ":1 {",
        "  # a comment {",
        "  @m path /a/* /b",
        "  handle @m {",
        "    import refuse",
        "  }",
        "  handle {",
        "    header {",
        '      X-One "a; b c"',
        "      -Server",
        "    }",
        "    import /etc/some.caddy",
        "  }",
        "}",
      ].join("\n"),
    );
    expect(tree.map((node) => node.tokens)).toEqual([[":1"]]);
    const one = site(tree, ":1");
    const [first, second] = handles(one);
    expect(first!.match).toEqual({ paths: ["/a/*", "/b"], file: false, not: false });
    expect(lines(first!.block)).toEqual(['respond {"a": 1} 404']);
    expect(second!.matcher).toBeNull();
    expect(lines(second!.block)).toEqual(["header", "X-One a; b c", "-Server", "import /etc/some.caddy"]);
  });

  test("reads path matchers with and without file, negated on one line or in a block, and evaluates them", () => {
    const block = site(
      parseCaddyfile([":1 {", "  @a path /x/*", "  @b {", "    path /x/*", "    file", "  }", "  @c {", "    not {", "      path /x/*", "      file", "    }", "  }", "  @d {", "    not path /x/*", "  }", "  @e header X-A b", "}"].join("\n")),
      ":1",
    );
    const m = pathMatchers(block);
    expect(m.get("@b")).toEqual({ paths: ["/x/*"], file: true, not: false });
    expect(m.get("@c")).toEqual({ paths: ["/x/*"], file: true, not: true });
    expect(m.get("@d")).toEqual({ paths: ["/x/*"], file: false, not: true });
    expect(m.get("@e")).toBeNull();
    const takes = (name: string, p: string, isFile: boolean) => matcherTakes(m.get(name), p, isFile);
    expect([takes("@a", "/x/y", false), takes("@b", "/x/y", false), takes("@b", "/x/y", true), takes("@c", "/x/y", false), takes("@c", "/x/y", true), takes("@c", "/z", true)]).toEqual([
      true,
      false,
      true,
      true,
      false,
      true,
    ]);
    expect(() => matcherTakes(m.get("@e"), "/x")).toThrow(/cannot evaluate/);
  });

  test("refuses a block left open or closed twice, and an unclosed quote", () => {
    expect(() => parseCaddyfile(":1 {\n")).toThrow(/open/);
    expect(() => parseCaddyfile("}\n")).toThrow(/never opened/);
    expect(() => parseCaddyfile(':1 {\n  respond "x 404\n}\n')).toThrow(/quote/);
  });

  test("orders handles as Caddy 2.11.4 does: one path most specific first, matchers before none, written order otherwise", () => {
    const order = (text: string) => caddyOrder(handles(site(parseCaddyfile(text), ":1"))).map((h) => h.matcher ?? "none");
    expect(order([":1 {", "  handle /api/* {", "  }", "  handle /api/staff {", "  }", "  handle /api/staff/* {", "  }", "  handle {", "  }", "}"].join("\n"))).toEqual([
      "/api/staff/*",
      "/api/staff",
      "/api/*",
      "none",
    ]);
    // What `caddy adapt` printed for this site on Caddy 2.11.4: a matcher with two paths compares equal to both
    // one-path handles, so the more specific /api/staff/* stays behind /api/* (the comparison is not transitive).
    expect(
      order([":1 {", "  handle /api/* {", "  }", "  @staff path /api/staff /api/staff/*", "  handle @staff {", "  }", "  handle /api/staff/* {", "  }", "  handle {", "  }", "}"].join("\n")),
    ).toEqual(["/api/*", "@staff", "/api/staff/*", "none"]);
  });
});

describe("the console site sends exactly the headers the development server sends", () => {
  test("the CSP of section 3, the one site-headers.mjs defines", () => {
    expect(consoleSiteHeadersFromCaddyfile()("/", false)["Content-Security-Policy"]).toBe(CONSOLE_CSP);
  });

  test("every header, for the page, the router's addresses, the icon and the hashed files", () => {
    const headersFor = consoleSiteHeadersFromCaddyfile();
    for (const p of PATHS) expect(headersFor(p, FILES.has(p)), p).toEqual(devHeaders(p));
  });

  test("the page is neither stored nor transformed, and only the hashed files are kept, for a year", () => {
    const headersFor = consoleSiteHeadersFromCaddyfile();
    for (const p of PATHS) {
      const hashedFile = FILES.has(p) && isHashedPath(p);
      expect(headersFor(p, FILES.has(p))["Cache-Control"], p).toBe(hashedFile ? "public, max-age=31536000, immutable" : "no-store, no-transform");
    }
    // The page answered for a hashed name the build does not hold is a page like any other, never kept under that name.
    expect(headersFor("/assets/main-MISSING0.js", false)["Cache-Control"]).toBe("no-store, no-transform");
    expect(headersFor("/assets/main-ABCDEFGH.js", true)["Cache-Control"]).toBe("public, max-age=31536000, immutable");
  });

  test("the development server takes its headers from site-headers.mjs and spells no policy of its own", () => {
    const devServer = read("apps", "admin", "dev-server.mjs");
    expect(devServer).toContain('import { consoleSiteHeaders } from "./site-headers.mjs";');
    expect(devServer).toMatch(/res\.writeHead\(200, \{ \.\.\.consoleSiteHeaders\(served\),/);
    expect(devServer).not.toMatch(/Content-Security-Policy|default-src|trusted-types|Permissions-Policy|immutable/i);
  });

  describe("and the development server's answers carry the Caddyfile's console headers", () => {
    let dist = "";
    let dev: Server;
    let base = "";

    beforeAll(async () => {
      dist = mkdtempSync(path.join(tmpdir(), "korbat-admin-site-"));
      mkdirSync(path.join(dist, "assets"));
      writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>console</title>");
      writeFileSync(path.join(dist, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
      writeFileSync(path.join(dist, "assets", "main-ABCDEFGH.js"), "console.log(1)");
      writeFileSync(path.join(dist, "assets", "main-ABCDEFGH.css"), "body{}");
      // No API answers here: only static files are asked for.
      dev = createDevServer({ dist, api: "http://127.0.0.1:9" });
      await new Promise<void>((resolve) => dev.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${(dev.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise((resolve) => dev.close(resolve));
      rmSync(dist, { recursive: true, force: true });
    });

    test("the same headers, and no other, on every static answer", async () => {
      const headersFor = consoleSiteHeadersFromCaddyfile();
      // What any HTTP server adds about the answer itself, beside the site's headers.
      const own = new Set(["content-type", "content-length", "date", "connection", "keep-alive", "transfer-encoding"]);
      for (const p of PATHS.filter((p) => p !== "/index.html")) {
        const res = await fetch(`${base}${p}`);
        expect(res.status, p).toBe(200);
        const expected = Object.fromEntries(Object.entries(headersFor(p, FILES.has(p))).map(([name, value]) => [name.toLowerCase(), value]));
        const sent = Object.fromEntries([...res.headers.entries()].filter(([name]) => !own.has(name)));
        expect(sent, p).toEqual(expected);
      }
    });
  });
});

describe("the console site's routes", () => {
  const consoleSite = () => site(readCaddyfile(), CONSOLE_SITE);

  test("the staff API, then the rest of the API, then the console's files, whatever order Caddy sorts them in", () => {
    const routes = caddyOrder(handles(consoleSite()));
    expect(routes.map((route) => route.match ?? null)).toEqual([{ paths: ["/api/staff", "/api/staff/*"], file: false, not: false }, { paths: ["/api", "/api/*"], file: false, not: false }, null]);
  });

  test("/api/staff and /api/staff/* go to the API as on the app's site: 64KB bodies, no Server header, cf-header, the browser's Host", () => {
    for (const p of ["/api/staff", "/api/staff/me", "/api/staff/sessions/2b7c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e", "/api/staff/enroll/options"]) {
      expect(routeFor(consoleSite(), p).match?.paths, p).toEqual(["/api/staff", "/api/staff/*"]);
    }
    const staff = routeFor(consoleSite(), "/api/staff/me").block;
    const body = staff.children?.find((node) => node.tokens[0] === "request_body");
    expect(body?.tokens).toEqual(["request_body"]);
    expect(lines(body!)).toEqual(["max_size 64KB"]);
    expect(lines(staff)).toContain("header -Server");
    const proxy = staff.children?.find((node) => node.tokens[0] === "reverse_proxy");
    expect(proxy?.tokens).toEqual(["reverse_proxy", "api:3000"]);
    // The import sits inside reverse_proxy, where header_up lines belong: a client-set CF-Connecting-IP is dropped unless TUNNEL=on.
    expect(lines(proxy!)).toEqual(["import /etc/caddy/cf-header.caddy"]);
    // The staff gate compares the Host the browser sent with CONSOLE_ORIGIN, so Caddy sets no Host of its own.
    expect(lines(staff).filter((line) => /header_up|header_down|transport|X-Forwarded/i.test(line))).toEqual([]);
  });

  test("any other path of the API is Caddy's own 404 and never reaches the API", () => {
    for (const p of ["/api", "/api/me", "/api/auth/signin", "/api/staffx", "/api/media"]) {
      const route = routeFor(consoleSite(), p);
      expect(route.match?.paths, p).toEqual(["/api", "/api/*"]);
      expectRefusal(route);
    }
  });

  test("everything else is the console's files from /console, outside the app's /srv, with index.html as the fallback, gzipped", () => {
    for (const p of ["/", "/signin", "/audit", "/enroll/abc", "/assets/main-ABCDEFGH.js", "/favicon.svg", "/apix"]) expect(routeFor(consoleSite(), p).matcher, p).toBeNull();
    const files = lines(routeFor(consoleSite(), "/").block);
    expect(files).toContain("root * /console");
    expect(files).toContain("encode gzip");
    expect(files).toContain("try_files {path} /index.html");
    expect(files).toContain("file_server");
    expect(files).toContain("-Server");
  });

  test("the app's site serves nothing from /console", () => {
    expect(lines(site(readCaddyfile(), APP_SITE)).filter((line) => line.includes("/console"))).toEqual([]);
  });
});

describe("the app's site refuses the staff API ahead of its API proxy", () => {
  const appSite = () => site(readCaddyfile(), APP_SITE);

  test("/api/staff and /api/staff/* reach a 404 of Caddy's own, whatever order Caddy sorts the handles in", () => {
    for (const p of ["/api/staff", "/api/staff/", "/api/staff/me", "/api/staff/signin/options", "/api/staff/sessions/2b7c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e"]) {
      expectRefusal(routeFor(appSite(), p));
    }
  });

  test("every other API path still reaches the API, and the rest the app's files", () => {
    for (const p of ["/api/me", "/api/auth/signin", "/api/media", "/api/staffx", "/api/staff-notes"]) {
      const route = routeFor(appSite(), p);
      expect(route.match?.paths, p).toEqual(["/api/*"]);
      expect(lines(route.block), p).toContain("reverse_proxy api:3000");
    }
    expect(lines(routeFor(appSite(), "/").block)).toContain("root * /srv");
  });

  test("the refusals match one path each, longer than /api/*, so Caddy sorts them first by its documented rule as well", () => {
    const refusals = handles(appSite()).filter((h) => h.match?.paths.some((p) => p.startsWith("/api/staff")));
    expect(refusals.map((h) => h.match?.paths)).toEqual(expect.arrayContaining([["/api/staff"], ["/api/staff/*"]]));
    expect(refusals).toHaveLength(2);
    const order = caddyOrder(handles(appSite())).map((h) => h.matcher);
    expect(order.indexOf("/api/*")).toBeGreaterThan(Math.max(order.indexOf("/api/staff"), order.indexOf("/api/staff/*")));
  });
});

describe("the image carries the console", () => {
  const dockerfile = () => read("infra", "caddy", "Dockerfile");
  /** The lines of one build stage, from its FROM to the next. */
  const stage = (name: string) => {
    const text = dockerfile();
    const start = text.search(new RegExp(`^FROM .+ AS ${name}$`, "m"));
    expect(start, `a stage named ${name}`).toBeGreaterThanOrEqual(0);
    const next = text.indexOf("\nFROM ", start + 1);
    return text.slice(start, next === -1 ? undefined : next);
  };

  test("the console is built in a stage of its own, from the same Node image as the app's, with only its own packages", () => {
    const web = stage("web");
    const admin = stage("console");
    expect(admin.split("\n")[0]!.replace(/ AS console$/, "")).toBe(web.split("\n")[0]!.replace(/ AS web$/, ""));
    expect(admin).toContain("COPY apps/admin ./apps/admin");
    expect(admin).not.toContain("COPY apps/app");
    expect(admin).toContain("RUN pnpm install --frozen-lockfile --filter @korbat/admin...");
    expect(admin).toContain("RUN pnpm --filter @korbat/admin build");
    // The page holds no build argument: nothing it is built from differs between instances.
    expect(admin).not.toMatch(/^ARG /m);
  });

  test("the final image serves the build from /console, outside the app's /srv, and exposes both sites' ports", () => {
    const text = dockerfile();
    expect(text).toContain("COPY --from=console /repo/apps/admin/dist /console");
    expect(text).toContain("COPY --from=web /repo/apps/app/dist /srv");
    expect(text).toMatch(/^EXPOSE 8080 8090$/m);
    expect(text).toContain("RUN setcap -r /usr/bin/caddy");
  });
});

describe("Compose and infra/.env.example carry the console", () => {
  /** One service's block of compose.yml: from its name to the next service's. */
  const service = (name: string) => {
    const compose = read("infra", "compose.yml");
    const start = compose.indexOf(`\n  ${name}:\n`);
    expect(start, name).toBeGreaterThanOrEqual(0);
    const next = compose.slice(start + 1).search(/\n {2}[a-z]+:\n/);
    return compose.slice(start, next === -1 ? undefined : start + 1 + next);
  };

  /** The comment lines right above a line of the file, joined into one text. */
  const commentAbove = (text: string, line: string) => {
    const all = text.split(/\r?\n/);
    const at = all.indexOf(line);
    expect(at, line).toBeGreaterThan(0);
    const comment: string[] = [];
    for (let i = at - 1; i >= 0 && all[i]!.trimStart().startsWith("#"); i--) comment.unshift(all[i]!.trim().replace(/^#\s?/, ""));
    return comment.join(" ");
  };

  test("the API gets the console's origin and relying party ID, empty by default", () => {
    const api = service("api");
    expect(api).toContain("CONSOLE_ORIGIN: ${API_CONSOLE_ORIGIN:-}");
    expect(api).toContain("CONSOLE_RP_ID: ${API_CONSOLE_RP_ID:-}");
  });

  test("Caddy's comment names both of its ports", () => {
    const compose = read("infra", "compose.yml");
    const comment = commentAbove(compose, "  caddy:");
    expect(comment).toContain("8080");
    expect(comment).toContain("8090");
  });

  test("the development stack publishes the console's site on localhost, on a port of its own", () => {
    const dev = read("infra", "compose.dev.yml");
    const caddy = dev.slice(dev.indexOf("\n  caddy:\n"), dev.indexOf("\n  mailpit:\n"));
    expect(caddy).toContain('"127.0.0.1:${DEV_CADDY_PORT:-8080}:8080"');
    expect(caddy).toContain('"127.0.0.1:${DEV_CONSOLE_PORT:-8090}:8090"');
  });

  test("infra/.env.example names the console's origin on the published port, and its development port", () => {
    const env = read("infra", ".env.example");
    expect(env).toMatch(/^API_CONSOLE_ORIGIN=http:\/\/localhost:8090$/m);
    expect(env).toMatch(/^API_CONSOLE_RP_ID=$/m);
    expect(env).toMatch(/^# DEV_CONSOLE_PORT=8090$/m);
    // The note that API_CONSOLE_ORIGIN names the same port on localhost.
    expect(commentAbove(env, "# DEV_CONSOLE_PORT=8090")).toMatch(/API_CONSOLE_ORIGIN must name the same port on localhost/);
    expect(commentAbove(env, "# DEV_PG_PORT=55432")).toMatch(/Defaults: 55432, 56379, 3000, 8080, 8090, 51025, 58025\./);
  });

  test("the passkey comment says the staff console does not use the app's RP ID, word for word", () => {
    const env = read("infra", ".env.example");
    expect(commentAbove(env, "API_WEBAUTHN_RP_ID=")).toBe(
      "Passkeys. The RP ID every passkey is bound to: empty means the host of API_APP_ORIGIN. It may instead be a parent domain of that host (korbat.example for app.korbat.example). The staff console does not use it: staff keys have their own RP ID. Production refuses an IP address or localhost. Choose it before the first passkey is added: changing it later strands every passkey.",
    );
  });

  test("the TUNNEL_TOKEN note names both hostnames and the port each points at", () => {
    const note = commentAbove(read("infra", ".env.example"), "TUNNEL_TOKEN=");
    expect(note).toContain("http://caddy:8080");
    expect(note).toContain("http://caddy:8090");
    expect(note).toMatch(/console/i);
  });
});

/** Nothing in the console site's block is left for a later reader to guess at: every directive is one this test knows. */
test("the console site holds only the directives these tests check", () => {
  const known = new Set(["@staff", "@api", "handle"]);
  const top = (site(readCaddyfile(), CONSOLE_SITE).children ?? []).map((node: CaddyNode) => node.tokens[0]);
  expect(top.filter((name) => !known.has(name ?? ""))).toEqual([]);
});
```

### Create `apps/admin/vitest.browser.config.ts`

```ts
import { defineConfig } from "vitest/config";

/**
 * The console's browser check (`pnpm --filter @korbat/admin test:browser`, 3a design, section 12): one walk through every
 * screen in Chromium, driven by playwright-core. It is kept apart from the unit tests because it builds the console and
 * starts a browser. Its steps share one page and run in order. The page shows times in the browser's time zone, which the
 * walk sets to UTC, as this sets the tests' own.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/browser/**/*.browser.ts"],
    env: { TZ: "UTC" },
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
```

## Step 2: run the tests and watch them fail

```bash
cd apps/admin && node ../../node_modules/vitest/vitest.mjs run test/console-site.test.ts
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
❯ test/console-site.test.ts (26 tests | 19 failed) 105ms
Test Files  1 failed (1)
Tests  19 failed | 7 passed (26)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/07-console-infrastructure.md 3
```

Expected: 11 lines starting with `wrote`, one for each file below.

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
      # The staff console over every screen under the console site's policy, read from the Caddyfile, in the runner's own
      # Chrome: no browser is downloaded, and no database or API is needed.
      - name: the console's browser check
        run: pnpm --filter @korbat/admin test:browser
        env:
          KORBAT_BROWSER_CHANNEL: chrome
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
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --build   # http://localhost:8080, and the staff console at http://localhost:8090
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:8090 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

The smoke test first checks the staff console's site: its page carries the console's own policy and is never stored, and the staff API answers there (401 without a session) and nowhere else (Caddy's own 404 on the app's site). It then signs up a throwaway account through Caddy, reads its code from Mailpit, posts and reads the post back from the public Latest timeline. It uploads a JPEG carrying a GPS position, posts it, and checks that the served file is a fresh WebP without metadata, that a symlink planted in the store from inside the worker gets a 404, and that deleting the post removes the image from disk. It checks the worker's isolation, then grants the account a staff role with the CLI and checks that its session was revoked.

After every sharp upgrade, add `--worst-case`: it also uploads flat-colour files at the pixel caps (48 MP 16-bit interlaced PNG, 48 MP progressive JPEG, 48 MP GIF, 16 MP AVIF), expects each to be ready without the worker being OOM-killed or restarted, and prints the worker's memory peak.

Caddy listens on 8080 inside its container as its own user, proxies `/api` to the API and serves the web app with the page's security headers; `index.html` is revalidated on every load and the hashed bundles are cached for a year. On 8090 it serves the staff console under the console's own policy and proxies only `/api/staff/*`, which the app's site refuses. The compose file keeps cloudflared, Caddy, the API and the data services on separate networks, so cloudflared reaches only Caddy and Caddy only the API.

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
pnpm --filter @korbat/admin test:browser   # every screen in Chromium under the console site's policy (below)
pnpm --filter @korbat/admin typecheck
```

The development server serves the build with the console site's headers, the policy included, on `127.0.0.1:8090` (`--port <number>` moves it: `pnpm --filter @korbat/admin dev --port 8091`), and forwards `/api/staff/*` to the API at `http://localhost:3000` with the `Host` header kept, so the API's staff gate sees the console's host. Start the API first (`pnpm --filter @korbat/api dev`) with `CONSOLE_ORIGIN=http://localhost:8090` in `apps/api/.env` (`node scripts/gen-dev-env.mjs` adds it), naming the same port. Open the console at `http://localhost:8090`, never `127.0.0.1`: browsers refuse WebAuthn on an IP address. A page that says the console is not available at this address means the API answered `/api/staff/me` with 404: `CONSOLE_ORIGIN` is unset, or names another address.

Caddy's console site (`infra/caddy/Caddyfile`, port 8090 in its container) sends exactly the headers of `site-headers.mjs`: `test/console-site.test.ts` reads the Caddyfile and compares the two, checks that the development server takes its headers from that module alone, and checks the site's routes (`/api/staff` and `/api/staff/*` to the API, any other `/api` path Caddy's own 404, everything else the console's files from `/console`) and that the app's site refuses the staff API ahead of its API proxy.

The browser check (`test/browser/`) builds the console into a temporary folder and serves it from a small Node server with the routes and headers of Caddy's console site, read from `infra/caddy/Caddyfile`, so the page is tested under the policy Caddy really sends. The server answers `/api/staff/*` from fixtures held in memory, whose handles, key names and browser labels are hostile: markup, `javascript:` URLs, a direction override and the longest names allowed. playwright-core then drives Chromium with a CDP virtual authenticator over every screen: the console switched off, enrolment (a synced passkey refused and explained, then a device-bound key that verifies its user), sign-in, home, a session revoked with the key, step-up options that bind another action refused before the key is asked, the audit log, an unknown address, the ended session and sign-out. Any policy report (the page's `securitypolicyviolation` events, Chromium's console and the CDP Log, DevTools issues), any page error and any dialog fails it. It needs no database or API and writes nothing outside its temporary folder. It never downloads a browser: by default it uses the Chromium build playwright-core 1.63.0 names (`chromium-1243` under `ms-playwright`), which must already be installed, and with `KORBAT_BROWSER_CHANNEL=chrome` it uses the machine's own Chrome, as CI does.
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
    "test": "vitest run",
    "test:browser": "vitest run --config vitest.browser.config.ts"
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
    "playwright-core": "1.63.0",
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

### Replace `apps/admin/tsconfig.json` (whole file)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2023", "DOM", "DOM.Iterable"], "jsx": "react-jsx", "types": ["node"] },
  "include": ["src", "test", "vitest.config.ts", "vitest.browser.config.ts", "*.d.mts"]
}
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
# Who checks the phone number behind the verified badge: off turns the badge off, dev accepts the code
# 000000 (development only; production refuses it), vonage texts a real code through Vonage Verify with the
# key and secret from the Vonage dashboard (the runbook in the 1b design says how).
API_VERIFY_PROVIDER=off
# Whether the web app's account settings show the verified badge section: on or off. Set it together with
# API_VERIFY_PROVIDER: off while that is off, on once it is dev or vonage (a section shown without a provider
# answers every Send code with "Verification is not available"). The web image reads it as EXPO_PUBLIC_BADGE,
# which Expo inlines at export time.
WEB_BADGE=off
API_VONAGE_API_KEY=
API_VONAGE_API_SECRET=
# The sender name of the verification text: 1 to 18 characters, none of / { } : $.
API_VERIFY_BRAND=korbat
# Passkeys. The RP ID every passkey is bound to: empty means the host of API_APP_ORIGIN. It may instead be a parent
# domain of that host (korbat.example for app.korbat.example). The staff console does not use it: staff keys have their
# own RP ID. Production refuses an IP address or localhost. Choose it before the first passkey is added: changing it
# later strands every passkey.
API_WEBAUTHN_RP_ID=
# The site name password managers show next to a korbat passkey: 1 to 64 printable characters; empty means korbat.
API_WEBAUTHN_RP_NAME=

# The staff console: the origin staff open it at, served by Caddy's second site (port 8090 in its container). Empty
# switches the console off: every /api/staff path then answers 404. It must differ from API_APP_ORIGIN and never appear
# in API_TRUSTED_ORIGINS. In development it is localhost on the port compose.dev.yml publishes the console on
# (DEV_CONSOLE_PORT below); open it there, never at 127.0.0.1. Production: https://<the console's own hostname>, a
# hostname apart from the app's.
API_CONSOLE_ORIGIN=http://localhost:8090
# The RP ID staff keys are bound to: empty means the hostname of API_CONSOLE_ORIGIN, which production requires. Choose
# the console's hostname before the first staff key is enrolled: moving the console later means enrolling every key
# again.
API_CONSOLE_RP_ID=

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
# tunnel has two public hostnames: the app's, pointing at http://caddy:8080, and the staff console's (the hostname of
# API_CONSOLE_ORIGIN), pointing at http://caddy:8090. Leave the HTTP Host Header setting of each empty, so the API sees
# the hostname the browser used.
TUNNEL_TOKEN=

# The development stack's host ports, read only by infra/compose.dev.yml. Set one when another container
# on this machine holds the default, and give apps/api/.env the same port. Defaults: 55432, 56379, 3000,
# 8080, 8090, 51025, 58025.
# DEV_PG_PORT=55432
# DEV_REDIS_PORT=56379
# DEV_API_PORT=3000
# DEV_CADDY_PORT=8080
# The staff console's port: API_CONSOLE_ORIGIN must name the same port on localhost (http://localhost:<port>).
# DEV_CONSOLE_PORT=8090
# DEV_SMTP_PORT=51025
# DEV_MAILPIT_PORT=58025
```

### Replace `infra/caddy/Caddyfile` (whole file)

```text
{
  auto_https off
  admin off
}

# Caddy's own 404 for an API path a site does not serve, in the API's error envelope, so the page's parser reads it as it
# reads the API's own 404. Nothing behind it is asked.
(api_not_found) {
  header -Server
  header Content-Type application/json
  header Cache-Control no-store
  respond `{"error":{"code":"not_found","message":"No such route"}}` 404
}

:8080 {
  # The staff API belongs to the console's site below, on an origin of its own: the app's site never forwards it. Each of
  # these handles matches one path, longer than /api/*, and Caddy puts such handles most specific first, so they come
  # ahead of the API proxy below wherever they are written.
  handle /api/staff {
    import api_not_found
  }
  handle /api/staff/* {
    import api_not_found
  }

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

# The staff console (3a design, section 8): a site of its own for the console's own origin, CONSOLE_ORIGIN. It serves the
# console's page and proxies the staff API and nothing else. It is always built and always serves the page; the API alone
# switches the console on, and while CONSOLE_ORIGIN is unset every staff path answers 404, which the page explains. Its
# handles each match two paths or none, so Caddy keeps them in the order written: the staff API, the rest of the API, the
# console's files.
:8090 {
  # The staff API, proxied as the app's site proxies /api/*. No header_up Host: the API's staff gate compares the Host the
  # browser sent with CONSOLE_ORIGIN. Caddy still replaces whatever X-Forwarded-* headers a client sent with its own.
  @staff path /api/staff /api/staff/*
  handle @staff {
    # Staff requests are small JSON. The API caps them at 64 KiB too.
    request_body {
      max_size 64KB
    }
    header -Server
    reverse_proxy api:3000 {
      # As on the app's site: the per-IP sign-in limits key on CF-Connecting-IP, which only cloudflared may set.
      import /etc/caddy/cf-header.caddy
    }
  }

  # The rest of the API is the app's, never the console's.
  @api path /api /api/*
  handle @api {
    import api_not_found
  }

  # The console's page, from /console, a folder outside the app's /srv, so the app's site can never serve it. Its policy
  # is the strict one of section 3: everything from this origin only, no inline script or style, and Trusted Types with no
  # policy, so no HTML or script sink can be used. apps/admin/site-headers.mjs holds the same headers for the development
  # server, and apps/admin/test/console-site.test.ts keeps the two equal.
  handle {
    root * /console
    encode gzip
    header {
      Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; require-trusted-types-for 'script'; trusted-types 'none'"
      Strict-Transport-Security "max-age=31536000; includeSubDomains"
      X-Content-Type-Options "nosniff"
      X-Frame-Options "DENY"
      Referrer-Policy "no-referrer"
      Cross-Origin-Opener-Policy "same-origin"
      Cross-Origin-Resource-Policy "same-origin"
      # WebAuthn for the console itself only; no camera, microphone or position for anyone.
      Permissions-Policy "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)"
      -Server
    }
    # The hashed script and stylesheet never change under their names. Everything else, the page above all, is neither
    # stored nor transformed: no-transform stops Cloudflare injecting scripts the policy would block on every page view.
    # `file` holds only when the path names a file of the build, so the page answered for a missing /assets/ name (the
    # fallback below) is never kept for a year under that name.
    @immutable {
      path /assets/*
      file
    }
    header @immutable Cache-Control "public, max-age=31536000, immutable"
    @page {
      not {
        path /assets/*
        file
      }
    }
    header @page Cache-Control "no-store, no-transform"
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
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
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
# Whether the account settings show the verified badge section (WEB_BADGE in infra/.env): on only when the API's
# verification provider is on, off by default as the provider is. Anything else is refused, so a typo cannot hide or show it.
ARG EXPO_PUBLIC_BADGE=off
RUN case "$EXPO_PUBLIC_BADGE" in on|off) ;; *) echo "EXPO_PUBLIC_BADGE must be on or off" >&2; exit 1;; esac
RUN cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY="$EXPO_PUBLIC_TURNSTILE_SITE_KEY" EXPO_PUBLIC_BADGE="$EXPO_PUBLIC_BADGE" npx expo export --platform web

# The staff console (apps/admin), in a stage of its own: its page takes no build argument and holds no secret, and its
# packages never meet the app's. esbuild writes dist/: index.html, favicon.svg and the hashed script and stylesheet.
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS console
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
# pnpm verifies the repository patches named in package.json at every install, hashed into the lockfile.
COPY patches ./patches
# pnpm at the version and hash the root package.json names; corepack verifies the download against the hash.
RUN corepack enable && corepack install
COPY packages ./packages
COPY apps/admin ./apps/admin
RUN pnpm install --frozen-lockfile --filter @korbat/admin...
RUN pnpm --filter @korbat/admin build

FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b
ARG TUNNEL=off
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
# Behind the tunnel cloudflared sets CF-Connecting-IP and the API needs it; anywhere else a client could set it.
RUN if [ "$TUNNEL" = "on" ]; then : > /etc/caddy/cf-header.caddy; else echo "header_up -CF-Connecting-IP" > /etc/caddy/cf-header.caddy; fi
COPY --from=web /repo/apps/app/dist /srv
# The console's site serves /console, a folder outside the app's /srv, so the app's site can never serve the console.
COPY --from=console /repo/apps/admin/dist /console
# The image's binary carries cap_net_bind_service as a file capability; with every capability dropped, the
# kernel refuses to run it ("operation not permitted"). Ports 8080 and 8090 need no capability, so it is removed.
RUN setcap -r /usr/bin/caddy
# Caddy runs as its own user on ports it may bind without privileges; its state directories are its own.
RUN adduser -D -u 10001 caddy && mkdir -p /data /config && chown -R caddy:caddy /data /config
USER caddy
# The app's site and the staff console's.
EXPOSE 8080 8090
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
    # The web app, and the staff console: open the console at http://localhost:<port>, never 127.0.0.1, and give
    # API_CONSOLE_ORIGIN the same port.
    ports: ["127.0.0.1:${DEV_CADDY_PORT:-8080}:8080", "127.0.0.1:${DEV_CONSOLE_PORT:-8090}:8090"]
  # Development mail catcher: SMTP on 51025, web UI and HTTP API on 58025. Never used in production.
  mailpit:
    image: axllent/mailpit:v1.31.2@sha256:74d609a42ec279aa63c6b4622a6fa9b5408d1ad5b1d76a1c4be40a265ce0863d
    restart: unless-stopped
    ports: ["127.0.0.1:${DEV_SMTP_PORT:-51025}:1025", "127.0.0.1:${DEV_MAILPIT_PORT:-58025}:8025"]
    networks: [data]
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
      # `staff.js enroll` runs here, as the migrator, the one role the running API never holds, and records on each link
      # the console's origin and relying party ID it is issued for. Empty, the console is off and enroll refuses.
      CONSOLE_ORIGIN: ${API_CONSOLE_ORIGIN:-}
      CONSOLE_RP_ID: ${API_CONSOLE_RP_ID:-}
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
      # The verified badge's phone check. off (the default) hides the badge; vonage needs the two credentials.
      VERIFY_PROVIDER: ${API_VERIFY_PROVIDER:-off}
      VONAGE_API_KEY: ${API_VONAGE_API_KEY:-}
      VONAGE_API_SECRET: ${API_VONAGE_API_SECRET:-}
      VERIFY_BRAND: ${API_VERIFY_BRAND:-korbat}
      # Passkeys. Empty values leave the API's defaults: the host of APP_ORIGIN as the RP ID and korbat as the name.
      WEBAUTHN_RP_ID: ${API_WEBAUTHN_RP_ID:-}
      WEBAUTHN_RP_NAME: ${API_WEBAUTHN_RP_NAME:-}
      # The staff console, served by Caddy's second site: the origin staff open it at, and the RP ID staff keys are bound
      # to (empty means the console's hostname). An empty origin switches the console off: every /api/staff path then
      # answers 404. The migrate service gets the same two values for `staff.js enroll`.
      CONSOLE_ORIGIN: ${API_CONSOLE_ORIGIN:-}
      CONSOLE_RP_ID: ${API_CONSOLE_RP_ID:-}
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

  # Caddy serves the web app on port 8080, proxying /api, and the staff console on port 8090, proxying only
  # /api/staff. It runs as its own user, sees only the API, and is the only thing cloudflared can reach.
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
        EXPO_PUBLIC_BADGE: ${WEB_BADGE:-off}
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

### Replace `scripts/smoke-auth-stack.mjs` (whole file)

```js
#!/usr/bin/env node
/**
 * Smoke test of the auth and social modules in a running Compose stack, through Caddy.
 *
 * 1. The web page's CSP allows the Turnstile widget.
 * 2. The staff console's site (--console): its page answers with the console's CSP, exactly, and
 *    Cache-Control: no-store, no-transform. /api/staff/me answers 404 on the app's site, from Caddy itself,
 *    and, signed out, 401 staff_session_required on the console's, so the API has the console on there.
 * 3. Signed out, Explore answers a page that parses; its ranking is computed within a minute (the refresh
 *    job runs a round at start), and by the answer's own Date header it is less than 11 minutes old.
 * 4. Password sign-in for an unknown email returns invalid_credentials (argon2 runs inside the image).
 * 5. A throwaway native-app account signs up with an emailed code read from Mailpit and onboards.
 * 6. /api/me answers for it.
 * 7. It posts, the post appears in the public Latest timeline, and its profile counts one post.
 * 8. It uploads a JPEG carrying a GPS position, waits until it is ready, and posts it without text. The
 *    original upload is gone, and large.webp is served to anyone as a fresh WebP without metadata.
 * 9. A symlink to /proc/self/environ, planted in the store from inside the worker, is refused with 404.
 * 10. Deleting the post stops the image being served, and its folder leaves the store.
 * 11. The worker has only a loopback interface and a 768 MiB memory limit, and has never restarted.
 * 12. With --worst-case, flat-colour files at the pixel caps (48 MP 16-bit interlaced PNG, 48 MP
 *     progressive JPEG, 48 MP GIF, 16 MP AVIF) all become ready without the worker being OOM-killed or
 *     restarted, and its memory peak is printed. Run it after every sharp upgrade.
 * 13. The grant-role CLI makes it a moderator, and its session stops working.
 * 14. A second throwaway account (the first one's session is gone by now, and a deleted account could not
 *     be granted a role) edits its bio, changes its handle, downloads its export as a ZIP, posts, and
 *     deletes itself with a code read from Mailpit and its handle typed; afterwards its profile is not
 *     found, its session is gone, and its post has left the Latest timeline.
 *
 * Runs only against a local Docker context. Needs API_TURNSTILE_SECRET_KEY set to Cloudflare's always-pass test secret and API_SMTP_URL pointing
 * at Mailpit, and API_CONSOLE_ORIGIN naming the --console address. Makes its images with the sharp the worker uses.
 * Tries a Turnstile refusal again for up to a minute, since outbound calls can stall. Prints no codes or tokens.
 *
 * Usage, from the repo root:
 *   node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:8090 \
 *     --mailpit http://localhost:58025 --terms draft-2026-09 [--worst-case] \
 *     -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { CONSOLE_CSP } from "../apps/admin/site-headers.mjs";

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const options = separator === -1 ? argv : argv.slice(0, separator);
const compose = separator === -1 ? [] : argv.slice(separator + 1);
const option = (name) => {
  const index = options.indexOf(`--${name}`);
  return index === -1 ? undefined : options[index + 1];
};
const base = option("base");
// The staff console's site: Caddy's second site, at exactly the address API_CONSOLE_ORIGIN names, never 127.0.0.1.
const consoleBase = option("console");
const mailpit = option("mailpit");
const terms = option("terms");
const worstCase = options.includes("--worst-case");
if (!base || !consoleBase || !mailpit || !terms || compose.length === 0) {
  console.error("usage: node scripts/smoke-auth-stack.mjs --base <url> --console <url> --mailpit <url> --terms <version> [--worst-case] -- <docker compose command>");
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

async function api(path, { json, token, method } = {}) {
  const headers = {};
  if (json !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { method: method ?? (json === undefined ? "GET" : "POST"), headers, body: json === undefined ? undefined : JSON.stringify(json) });
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

/** A GET of a full URL: the status, the headers, and the body when it is JSON. */
async function getJson(url) {
  const res = await fetch(url);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body, summary: `HTTP ${res.status}${body?.error?.code ? ` ${body.error.code}` : ""}` };
}

/**
 * The staff console's site (3a design, sections 8 and 12). Its page carries the console's own policy, the one
 * apps/admin/site-headers.mjs defines and the Caddyfile's console site sends, and is neither stored nor transformed. The
 * staff API answers only there: the app's site refuses it itself, with a 404 that carries no request id (the API puts one
 * in every error it answers, so none means Caddy answered ahead of its API proxy), and the console's site hands it to the
 * API, whose staff gate accepts the console's Host and, without a session, answers 401. A 404 there means the API has the
 * console off (API_CONSOLE_ORIGIN empty) or API_CONSOLE_ORIGIN names another address than --console.
 */
async function consoleSite() {
  const page = await fetch(`${consoleBase}/`);
  const csp = page.headers.get("content-security-policy");
  check("the console's page answers with the console's CSP, exactly", page.status === 200 && csp === CONSOLE_CSP, `HTTP ${page.status}, ${csp ?? "no CSP"}`);
  const cache = page.headers.get("cache-control");
  check("the console's page is neither stored nor transformed", cache === "no-store, no-transform", cache ?? "no Cache-Control");

  const onApp = await getJson(`${base}/api/staff/me`);
  check("the app's site answers /api/staff/me with 404", onApp.status === 404 && onApp.body?.error?.code === "not_found", onApp.summary);
  check("the app's site refuses the staff API itself, ahead of its API proxy", onApp.status === 404 && onApp.body?.error?.requestId === undefined, onApp.body?.error?.requestId ? "the API answered" : onApp.summary);

  const onConsole = await getJson(`${consoleBase}/api/staff/me`);
  check("signed out, the console's site answers /api/staff/me with 401 staff_session_required", onConsole.status === 401 && onConsole.body?.error?.code === "staff_session_required", onConsole.summary);
}

/**
 * Explore signed out (2c design, section 13). The page's fields are checked by hand: post items only, at most the
 * signed-out page of 20, no cursor, a boolean signInForMore and computedAt null or a time. The refresh job runs a round
 * as the API starts, so computedAt is polled for up to a minute. Its age is measured against the answer's Date header,
 * the server's clock rather than this machine's, and stays under 11 minutes: a round at most every 5 minutes, one that
 * skips because the last ranking is under 4.5 minutes old, and a minute and a half to spare.
 */
async function explore() {
  const deadline = Date.now() + 60_000;
  let answer;
  let page = null;
  for (;;) {
    answer = await send("/api/timeline/explore");
    try {
      page = JSON.parse(answer.bytes.toString("utf8"));
    } catch {
      page = null;
    }
    if (answer.status !== 200 || typeof page?.computedAt === "string" || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const items = Array.isArray(page?.items) ? page.items : null;
  const posts = items !== null && items.every((item) => item?.kind === "post" && typeof item.post?.id === "string" && typeof item.post?.author?.handle === "string");
  const parses =
    answer.status === 200 &&
    posts &&
    items.length <= 20 &&
    page.nextCursor === null &&
    typeof page.signInForMore === "boolean" &&
    (page.computedAt === null || (typeof page.computedAt === "string" && !Number.isNaN(Date.parse(page.computedAt))));
  check("signed out, Explore answers a page that parses", parses, `HTTP ${answer.status}, ${items === null ? "no" : items.length} posts`);
  if (!check("Explore has a ranking within a minute", typeof page?.computedAt === "string", page?.computedAt ?? "computedAt is null")) return;
  const age = Date.parse(answer.headers.get("date") ?? "") - Date.parse(page.computedAt);
  check("by the answer's Date header, the ranking is less than 11 minutes old", Number.isFinite(age) && age < 11 * 60 * 1000, `${Math.round(age / 1000)} s`);
}

/** The first 6-digit code in the newest message to `to`, or in the newest one with `subject` when an older code email is already in the box. */
async function emailCode(to, subject) {
  const query = encodeURIComponent(`to:"${to}"`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${query}`)).json();
    const newest = subject === undefined ? list.messages?.[0] : list.messages?.find((message) => message.Subject === subject);
    if (newest) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${newest.ID}`)).json();
      const code = /\b(\d{6})\b/.exec(message.Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no code email to ${to} arrived in Mailpit`);
}

/**
 * A second account, since the first one's session is gone by now and a deleted account could not be
 * granted a role: the lifecycle of section 7 of the 1b design, end to end, on the bearer session.
 */
async function accountLifecycle() {
  const email = `lifecycle-${randomUUID()}@korbat.local`;
  const handle = `life_${randomBytes(4).toString("hex")}`;
  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("lifecycle: email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await emailCode(email) } });
  if (!check("lifecycle: sign-up code read from Mailpit", verify.body?.result === "signup_required", verify.summary)) return;
  const complete = await api("/api/auth/signup/complete", { json: { flowId, dateOfBirth: "1990-01-01", termsVersion: terms } });
  if (!check("lifecycle: sign-up returns a bearer token", typeof complete.body?.token === "string", complete.summary)) return;
  const onboarding = await api("/api/auth/onboarding/handle", { json: { handle, displayName: "Lifecycle Test" }, token: complete.body.token });
  if (!check("lifecycle: onboarding rotates the token", typeof onboarding.body?.token === "string", onboarding.summary)) return;
  const token = onboarding.body.token;

  const edited = await api("/api/me/profile", { method: "PATCH", json: { bio: "Here for the smoke test." }, token });
  check("edit the bio", edited.status === 200 && edited.body?.profile?.bio === "Here for the smoke test.", edited.summary);
  const renamed = `${handle}_2`;
  const changed = await api("/api/me/handle", { json: { handle: renamed }, token });
  check("change the handle", changed.status === 200 && changed.body?.profile?.handle === renamed, changed.summary);
  const exported = await send("/api/account/export", { method: "POST", token });
  const zip = exported.bytes[0] === 0x50 && exported.bytes[1] === 0x4b;
  check("the export is a ZIP", exported.status === 200 && exported.headers.get("content-type") === "application/zip" && zip, `HTTP ${exported.status}, ${exported.headers.get("content-type")}, ${exported.bytes.length} bytes`);
  const posted = await api("/api/posts", { json: { body: "a post that will not outlive its author" }, token });
  check("lifecycle: create a post", posted.status === 201 && typeof posted.body?.id === "string", posted.summary);

  const deletion = await api("/api/account/delete/start", { json: {}, token });
  if (!check("delete/start", deletion.status === 200 && typeof deletion.body?.flowId === "string", deletion.summary)) return;
  // The sign-up code email is still in the box, so the deletion code is picked by its subject.
  const code = await emailCode(email, "Confirm deleting your korbat account");
  const confirmed = await api("/api/account/delete/confirm", { json: { flowId: deletion.body.flowId, code, handle: renamed }, token });
  check("delete/confirm with the code from Mailpit and the handle typed", confirmed.status === 204, confirmed.summary);
  const profile = await api(`/api/profiles/${renamed}`);
  check("the deleted profile is not found", profile.status === 404 && profile.body?.error?.code === "not_found", profile.summary);
  const me = await api("/api/me", { token });
  check("the deleted account's session is gone", me.status === 401, me.summary);
  const latest = await api("/api/timeline/latest");
  check("its post has left the Latest timeline", Array.isArray(latest.body?.items) && !latest.body.items.some((item) => item.post?.id === posted.body?.id), latest.summary);
}

async function main() {
  const page = await fetch(`${base}/`);
  const csp = page.headers.get("content-security-policy") ?? "";
  check("web CSP allows the Turnstile widget", csp.includes("script-src 'self' https://challenges.cloudflare.com") && csp.includes("frame-src https://challenges.cloudflare.com"));

  await consoleSite();
  await explore();

  const unknown = await withTurnstile("/api/auth/password/signin", { email: `nobody-${randomUUID()}@korbat.local`, password: "not a real password", turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  check("password sign-in for an unknown email", unknown.body?.error?.code === "invalid_credentials", unknown.summary);

  const start = await withTurnstile("/api/auth/email/start", { email, turnstileToken: TURNSTILE_TOKEN, deviceId, platform: "ios" });
  if (!check("email/start", start.status === 200, start.summary)) return;
  const { flowId } = start.body;
  const verify = await api("/api/auth/email/verify", { json: { flowId, code: await emailCode(email) } });
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

  await accountLifecycle();
}

try {
  await main();
} catch (err) {
  check("smoke test ran to the end", false, err instanceof Error ? err.message : String(err));
}
console.log(failures === 0 ? "smoke test passed" : `smoke test FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
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
Done in 4.9s using pnpm v10.30.0
```

## Step 5: verify: lockfile-age

```bash
node scripts/check-lockfile-age.mjs --base HEAD
```

Expected output contains:

- `all at least 7 days old`

Observed on the dry run:

```text
1 new package versions since HEAD; all at least 7 days old
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
apps/admin test:       Tests  193 passed (193)
apps/app test:       Tests  108 passed (108)
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
Tests  193 passed (193)
```

## Step 9: verify: admin-browser

```bash
pnpm --filter @korbat/admin test:browser
```

Expected output contains:

- `Tests  12 passed (12)`

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  12 passed (12)
```

## Step 10: verify: compose-config

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok
```

Expected output contains:

- `config-ok`

Observed on the dry run:

```text
config-ok
```

## Step 11: verify: compose-dev-config

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml -f infra/compose.dev.yml config -q && echo dev-config-ok
```

Expected output contains:

- `dev-config-ok`

Observed on the dry run:

```text
dev-config-ok
```

## Step 12: verify: stack-down

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok
```

Expected output contains:

- `down-ok`

Observed on the dry run:

```text
down-ok
```

## Step 13: verify: build

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml build > .data/stack-build.log 2>&1; echo build-exit=$?; tail -3 .data/stack-build.log
```

Expected output contains:

- `build-exit=0`

Observed on the dry run:

```text
build-exit=0
```

## Step 14: verify: stack-up

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok
```

Expected output contains:

- `up-ok`

Observed on the dry run:

```text
up-ok
```

## Step 15: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 16: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:$CONSOLE_PORT --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `smoke test passed`

Observed on the dry run:

```text
smoke test passed
```

## Step 17: verify: stack-stop

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker cloudflared 2>/dev/null; docker compose -f infra/compose.yml -f infra/compose.dev.yml ps --format '{{.Name}} {{.Status}}'
```

Expected output contains:

- `postgres-1 Up`

Observed on the dry run:

```text
korbat-postgres-1 Up 54 seconds (healthy)
```

## Step 18: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `.github/workflows/ci.yml`
- `README.md`
- `apps/admin/README.md`
- `apps/admin/package.json`
- `apps/admin/test/browser/console.browser.ts`
- `apps/admin/test/browser/fixture-api.ts`
- `apps/admin/test/browser/server.ts`
- `apps/admin/test/browser/watch.ts`
- `apps/admin/test/caddyfile.ts`
- `apps/admin/test/console-site.test.ts`
- `apps/admin/tsconfig.json`
- `apps/admin/vitest.browser.config.ts`
- `infra/.env.example`
- `infra/caddy/Caddyfile`
- `infra/caddy/Dockerfile`
- `infra/compose.dev.yml`
- `infra/compose.yml`
- `pnpm-lock.yaml`
- `scripts/smoke-auth-stack.mjs`

## Step 19: commit

```bash
git add -A
git commit -q -m "feat(infra,admin,ci): the staff console's site: Caddy serves the console from /console on port 8090 under the strict policy and the headers of apps/admin/site-headers.mjs, with no-store, no-transform on the page and immutable only on real hashed files, proxies only /api/staff to the API with the app's body limit and Cloudflare header rule, and answers every other /api path 404; the app's site refuses /api/staff before its API proxy; the image builds the console in a stage of its own; Compose passes CONSOLE_ORIGIN and CONSOLE_RP_ID to the API and publishes the console on DEV_CONSOLE_PORT in development; the smoke test requires --console and checks the console's policy and both sites' staff answers; a committed browser check drives Chromium with a virtual authenticator over every screen against hostile fixtures and fails on any policy or Trusted Types report, and CI runs it with the runner's Chrome" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(infra,admin,ci): the staff console's site: Caddy serves the console from /console on port 8090 under the strict policy and the headers of apps/admin/site-headers.mjs, with no-store, no-transform on the page and immutable only on real hashed files, proxies only /api/staff to the API with the app's body limit and Cloudflare header rule, and answers every other /api path 404; the app's site refuses /api/staff before its API proxy; the image builds the console in a stage of its own; Compose passes CONSOLE_ORIGIN and CONSOLE_RP_ID to the API and publishes the console on DEV_CONSOLE_PORT in development; the smoke test requires --console and checks the console's policy and both sites' staff answers; a committed browser check drives Chromium with a virtual authenticator over every screen against hostile fixtures and fails on any policy or Trusted Types report, and CI runs it with the runner's Chrome`.

## Report format (mandatory)

```text
TASK 7 REPORT
Files written: <count, expected 18>
Failing-test step (the error line): <paste>
Verify "frozen-install": <paste the expected lines as printed>
Verify "lockfile-age": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "admin-test": <paste the expected lines as printed>
Verify "admin-browser": <paste the expected lines as printed>
Verify "compose-config": <paste the expected lines as printed>
Verify "compose-dev-config": <paste the expected lines as printed>
Verify "stack-down": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "stack-up": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "smoke": <paste the expected lines as printed>
Verify "stack-stop": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
