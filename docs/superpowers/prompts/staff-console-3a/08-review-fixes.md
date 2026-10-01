# korbat staff console (3a) — Task 8 of 9: What the review of 3a upheld, fixed: the console checks every ceremony's challenge before it asks for a key, audit-verify reads every row whatever its place, keys are judged by the origin and relying party they were enrolled for, the enrolment page's sign-in check uses the new key, and fifteen smaller fixes and tests

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-30 and 2026-10-01 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Tasks 1 to 7 built and served the staff console. Six finders reviewed that range, refuters tried to knock each finding down, and a browser walk-through drove the real console against the rebuilt stack (143 checks passed). This task fixes the 19 findings that held, among them one high: the console signed whatever challenge the API handed it at sign-in. The design is `docs/superpowers/specs/2026-09-28-staff-console-3a-design.md`.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000, 8080 and 8090 on localhost must be free. Stop any korbat API, worker, web or console process started from this repository first; never stop other Node processes on the machine, and never touch Docker containers, volumes or images that do not belong to the `korbat` compose project.
- `infra/.env` (gitignored) must hold the line `API_CONSOLE_ORIGIN=http://localhost:8090` before the stack is rebuilt: the stack gates start the console site and the smoke test checks it there. If `grep -c '^API_CONSOLE_ORIGIN=' infra/.env` prints `0`, add it with `echo >> infra/.env && echo API_CONSOLE_ORIGIN=http://localhost:8090 >> infra/.env` (the line holds no secret). The dry run used port 8390 in its scratch clone.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(infra,admin,ci): the staff console's site: Caddy serves the console from /console on port 8090 under the strict policy and the headers of apps/admin/site-headers.mjs, with no-store, no-transform on the page and immutable only on real hashed files, proxies only /api/staff to the API with the app's body limit and Cloudflare header rule, and answers every other /api path 404; the app's site refuses /api/staff before its API proxy; the image builds the console in a stage of its own; Compose passes CONSOLE_ORIGIN and CONSOLE_RP_ID to the API and publishes the console on DEV_CONSOLE_PORT in development; the smoke test requires --console and checks the console's policy and both sites' staff answers; a committed browser check drives Chromium with a virtual authenticator over every screen against hostile fixtures and fails on any policy or Trusted Types report, and CI runs it with the runner's Chrome`.

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
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/08-review-fixes.md 1
```

Expected: 26 lines starting with `wrote`, one for each file below.

### Create `apps/admin/test/fixture-statuses.test.ts`

```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { StaffErrorCode } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { REFUSAL_STATUS } from "./browser/fixture-api";

/**
 * The browser check's fixtures answer each staff refusal with the status the API answers it with (3a design, section 12:
 * the fixtures answer as the API behind Caddy's console site would), so the console meets in the check what it meets in
 * production, and the check's watcher allows exactly the statuses the API sends. The API's statuses are read from its own
 * source, where every staff refusal is an AuthError with its code and status.
 */
const STAFF_FLOWS = path.resolve(import.meta.dirname, "../../api/src/auth/staff");

/** Every (code, status) pair the staff flows raise, from `new AuthError("staff_...", NNN)`. */
function apiStatuses(): Map<string, Set<number>> {
  const found = new Map<string, Set<number>>();
  for (const file of readdirSync(STAFF_FLOWS).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(path.join(STAFF_FLOWS, file), "utf8");
    for (const match of source.matchAll(/new AuthError\("(staff_[a-z_]+)", (\d{3})\)/g)) {
      const statuses = found.get(match[1]!) ?? new Set<number>();
      statuses.add(Number(match[2]));
      found.set(match[1]!, statuses);
    }
  }
  return found;
}

describe("the browser check's refusals carry the API's statuses", () => {
  test("every staff code the API raises has one status, and the fixtures answer it with that status", () => {
    const api = apiStatuses();
    // Every code the staff flows raise, so a scan that found nothing cannot pass.
    expect([...api.keys()].sort()).toEqual([...StaffErrorCode.options].sort());
    for (const [code, statuses] of api) {
      expect([...statuses], code).toHaveLength(1);
      expect(REFUSAL_STATUS[code as StaffErrorCode], code).toBe([...statuses][0]);
    }
  });
});
```

### Create `apps/admin/test/sign-in.test.ts`

```ts
import { CHALLENGE_PURPOSES, STAFF_STEP_UP_CHALLENGE } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import { CeremonyMismatch, checkSignInChallenge } from "../src/challenge";
import { signInWithKey } from "../src/sign-in";
import { ceremonyChallenge, fakeCredentials, fakeFetch, makeMe, registerChallenge, revokeAction, SESSION_HANDLE, signInOptions, stepUpChallenge } from "./fixtures";

/**
 * The check of sign-in options before the key is asked (3a design, section 9, F1 of the review of Tasks 1 to 7): the
 * challenge must be the contracts' 58-byte layout, version 1, with the staff_signin purpose and the zero binding of a
 * challenge bound to nothing. Otherwise navigator.credentials.get is never called. A step-up challenge served as sign-in
 * options would otherwise be signed at an ordinary sign-in, and the assertion would pass audit-verify as a confirmation
 * of an action the person never chose.
 */
const ME = makeMe();

/** A whole sign-in over a fake API that answers the sign-in options with `options`. */
async function signInWith(options: unknown, only?: string) {
  const fake = fakeFetch({
    "POST /api/staff/signin/options": { status: 200, body: options },
    "POST /api/staff/signin/verify": { status: 200, body: ME },
  });
  const credentials = fakeCredentials();
  const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
  const outcome = await signInWithKey({ api, credentials }, only).catch((err: unknown) => err);
  return { outcome, credentials, requests: fake.requests };
}

describe("the check of sign-in options", () => {
  test("a staff sign-in challenge passes, and the key is asked once, then the assertion is sent", async () => {
    expect(() => checkSignInChallenge(signInOptions().options)).not.toThrow();
    const run = await signInWith(signInOptions());
    expect(run.outcome).toEqual(ME);
    expect(run.credentials.calls.map((c) => c.kind)).toEqual(["get"]);
    expect(run.requests.map((r) => `${r.method} ${r.url} ${r.headers["x-staff-activity"]}`)).toEqual(["POST /api/staff/signin/options 1", "POST /api/staff/signin/verify 1"]);
  });

  const refusals: [string, () => Promise<string>][] = [
    // The attack: an API under an attacker's control hands out a step-up challenge for an action of its choosing.
    ["a step-up challenge (74 bytes, bound to an action)", () => stepUpChallenge(SESSION_HANDLE, revokeAction("4f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a"))],
    ["a step-up challenge cut to 58 bytes", () => stepUpChallenge(SESSION_HANDLE, revokeAction("4f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a"), { bytes: 58 })],
    ["the step-up purpose in the 58-byte layout", async () => ceremonyChallenge({ purpose: STAFF_STEP_UP_CHALLENGE.purpose })],
    ["an app sign-in's purpose", async () => ceremonyChallenge({ purpose: CHALLENGE_PURPOSES.signin })],
    ["a staff registration's purpose", async () => registerChallenge()],
    ["another version", async () => ceremonyChallenge({ version: 2 })],
    ["a binding, where a sign-in is bound to nothing", async () => ceremonyChallenge({ binding: Buffer.alloc(16, 1) })],
    ["one byte short", async () => ceremonyChallenge({ bytes: 57 })],
    ["one byte long", async () => ceremonyChallenge({ bytes: 59 })],
  ];

  for (const [name, make] of refusals) {
    test(`refused before the key is asked: ${name}`, async () => {
      const options = signInOptions(await make());
      expect(() => checkSignInChallenge(options.options)).toThrow(CeremonyMismatch);
      const run = await signInWith(options);
      expect(run.outcome).toBeInstanceOf(CeremonyMismatch);
      expect((run.outcome as CeremonyMismatch).code).toBe("signin_mismatch");
      expect(run.credentials.calls).toEqual([]);
      // The options were asked for, and nothing was sent after them.
      expect(run.requests.map((r) => r.url)).toEqual(["/api/staff/signin/options"]);
    });
  }
});

describe("signing in with one key only", () => {
  test("the allow list holds exactly the key named, whatever the options listed", async () => {
    const options = signInOptions();
    const listed = { options: { ...options.options, allowCredentials: [{ id: "b3RoZXIta2V5", type: "public-key" }] } };
    const run = await signInWith(listed, "bmV3LWtleQ");
    expect(run.outcome).toEqual(ME);
    const asked = run.credentials.calls[0]!.options as { publicKey: PublicKeyCredentialRequestOptions };
    expect(asked.publicKey.allowCredentials?.map((c) => [Buffer.from(c.id as Uint8Array).toString("base64url"), c.type])).toEqual([["bmV3LWtleQ", "public-key"]]);
    expect(asked.publicKey.userVerification).toBe("required");
  });

  test("options for one key are checked like any other", async () => {
    const run = await signInWith(signInOptions(await stepUpChallenge(SESSION_HANDLE, revokeAction(SESSION_HANDLE))), "bmV3LWtleQ");
    expect(run.outcome).toBeInstanceOf(CeremonyMismatch);
    expect(run.credentials.calls).toEqual([]);
  });
});
```

### Replace `apps/admin/test/audit-log.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import type { AuditPage } from "@korbat/contracts";
import { createAuditPager, createAuditReader, parsePlace, type AuditPageView } from "../src/audit-log";
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

/** A reader whose every read waits until the test answers it, in whatever order the test chooses. */
function deferredReader() {
  const asked: { what: string; answer(page: AuditPage): Promise<void>; fail(err: unknown): Promise<void> }[] = [];
  // Answering lets the pager's own await run before the test looks at what it showed.
  const settled = () => new Promise<void>((done) => setImmediate(done));
  const ask = (what: string) =>
    new Promise<AuditPage>((resolve, reject) => {
      asked.push({
        what,
        answer: (page) => {
          resolve(page);
          return settled();
        },
        fail: (err) => {
          reject(err);
          return settled();
        },
      });
    });
  return { asked, reader: { newest: () => ask("newest"), older: (cursor: number) => ask(`older ${cursor}`), at: (place: number) => ask(`at ${place}`) } };
}

/** The rows from place `from` down to place `to`, with the cursor an answer gives when older rows remain. */
const rows = (from: number, to: number, nextCursor: number | null): AuditPage => ({
  entries: Array.from({ length: from - to + 1 }, (_, i) => entry(from - i)),
  nextCursor,
});
const seqs = (view: AuditPageView) => (view.page.state === "ready" ? view.page.value.map((e) => e.seq) : view.page.state);
const span = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => from - i);

describe("the audit page: each answer shown only on the page it was asked for", () => {
  function setup() {
    const d = deferredReader();
    const shown: AuditPageView[] = [];
    const pager = createAuditPager(d.reader, (view) => shown.push(view));
    return { ...d, pager, last: () => shown[shown.length - 1]! };
  }

  test("Load older appends the older rows to the page they were asked from, and reads on from their cursor", async () => {
    const s = setup();
    void s.pager.newest();
    await s.asked[0]!.answer(rows(160, 111, 111));
    void s.pager.older();
    expect(s.last().loadingOlder).toBe(true);
    await s.asked[1]!.answer(rows(110, 61, 61));
    expect(seqs(s.last())).toEqual(span(160, 61));
    expect(s.last()).toMatchObject({ cursor: 61, at: null, loadingOlder: false });
  });

  for (const order of ["the place first", "the older rows first"] as const) {
    test(`an older page still in flight when Go to place opens another is dropped (${order} answering)`, async () => {
      const s = setup();
      void s.pager.newest();
      await s.asked[0]!.answer(rows(160, 111, 111));
      void s.pager.older();
      void s.pager.at(75);
      expect(s.asked.map((a) => a.what)).toEqual(["newest", "older 111", "at 75"]);
      if (order === "the place first") {
        await s.asked[2]!.answer(rows(75, 26, 26));
        await s.asked[1]!.answer(rows(110, 61, 61));
      } else {
        await s.asked[1]!.answer(rows(110, 61, 61));
        // Until the place's page arrives the page is loading, never the older rows of the page that was left.
        expect(seqs(s.last())).toBe("loading");
        await s.asked[2]!.answer(rows(75, 26, 26));
      }
      expect(seqs(s.last())).toEqual(span(75, 26));
      expect(s.last()).toMatchObject({ cursor: 26, at: 75, loadingOlder: false });
      // Load older now reads on from the place's page.
      void s.pager.older();
      expect(s.asked[3]!.what).toBe("older 26");
    });
  }

  test("an older page still in flight when Newest opens the newest again is dropped", async () => {
    const s = setup();
    void s.pager.at(75);
    await s.asked[0]!.answer(rows(75, 26, 26));
    void s.pager.older();
    void s.pager.newest();
    await s.asked[1]!.answer(rows(25, 1, null));
    await s.asked[2]!.answer(rows(160, 111, 111));
    expect(seqs(s.last())).toEqual(span(160, 111));
    expect(s.last()).toMatchObject({ cursor: 111, at: null, loadingOlder: false });
  });

  test("a page opened before another one that answers later is dropped", async () => {
    const s = setup();
    void s.pager.at(75);
    void s.pager.newest();
    await s.asked[1]!.answer(rows(160, 111, 111));
    await s.asked[0]!.answer(rows(75, 26, 26));
    expect(seqs(s.last())).toEqual(span(160, 111));
    expect(s.last().at).toBeNull();
  });

  test("an older page that failed after another page opened says nothing on it", async () => {
    const s = setup();
    void s.pager.newest();
    await s.asked[0]!.answer(rows(160, 111, 111));
    void s.pager.older();
    void s.pager.at(75);
    await s.asked[2]!.answer(rows(75, 26, 26));
    await s.asked[1]!.fail(new Error("network"));
    expect(s.last()).toMatchObject({ error: null, at: 75, loadingOlder: false });
  });

  test("while a page loads there is nothing older to ask for", async () => {
    const s = setup();
    void s.pager.newest();
    await s.asked[0]!.answer(rows(160, 111, 111));
    void s.pager.at(75);
    expect(s.last().cursor).toBeNull();
    void s.pager.older();
    expect(s.asked.map((a) => a.what)).toEqual(["newest", "at 75"]);
  });

  test("nothing is shown once the screen has gone", async () => {
    const s = setup();
    void s.pager.newest();
    const before = s.last();
    s.pager.stop();
    await s.asked[0]!.answer(rows(160, 111, 111));
    expect(s.last()).toBe(before);
  });
});
```

### Replace `apps/admin/test/browser/console.browser.ts` (whole file)

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
 * passkey refused, then a device-bound key that verifies its user, whose success page signs in with that key), home, a
 * session revoked with the key, step-up options that bind another action refused before the key is asked, the audit log,
 * an address the console does not have, the ended session, a second key enrolled while signed in, whose success page
 * asks that key and no other, sign-out, and sign-in options that carry a step-up challenge refused before the key is
 * asked. Each step fails on any policy report through any channel console-lab.md names, any page error and any dialog. It
 * needs no database and writes nothing but a temporary build.
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
/** The device-bound authenticator that holds the first staff key enrolled. */
let staffAuthenticator = "";
/** Every device-bound authenticator the walk enrolled a staff key on. */
const staffAuthenticators: string[] = [];
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

/** How many times an authenticator's keys have signed: the virtual authenticator counts every signature. */
async function signaturesOf(authenticatorId: string): Promise<number> {
  const { credentials } = await watcher.cdp.send("WebAuthn.getCredentials", { authenticatorId });
  return credentials.reduce((sum, credential) => sum + credential.signCount, 0);
}

/** How many times every staff key of the walk has signed. */
async function signatures(): Promise<number> {
  let sum = 0;
  for (const id of staffAuthenticators) sum += await signaturesOf(id);
  return sum;
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
    staffAuthenticators.push(staffAuthenticator);
    await page.getByRole("button", { name: "Register a security key" }).click();
    await shown(page.getByText("is registered", { exact: false }));
    expect(await texts()).toContain(TYPED_KEY_NAME);
    expect(fixtures.state.enrolmentUsed).toBe(true);
    await clean();
  });

  test("the success page signs in with the new key, which opens the console, and home follows", async () => {
    // The registration counted as one use of the key; the sign-in is the next.
    const before = await signatures();
    await page.getByRole("button", { name: "Sign in with this key" }).click();
    await shown(page.getByText("opened the console", { exact: false }));
    expect(await signatures()).toBe(before + 1);
    await page.getByRole("link", { name: "Go to the home page" }).click();
    await shown(page.getByRole("heading", { name: "Home" }));
    expect(page.url()).toBe(`${origin}/`);
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

  test("a second key enrolled while signed in: its success page asks that key, never the session's, and signs in with it", async () => {
    const first = staffAuthenticator;
    const token = fixtures.issueEnrolment();
    // The first key holds the live session; it could answer nothing here unless the page asked it, which this would show.
    await watcher.cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: first, enabled: false });
    const second = await addAuthenticator("device-bound security key");
    staffAuthenticators.push(second);
    await page.goto(`${origin}/enroll/${token}`);
    await shown(page.getByRole("heading", { name: "Register a staff key" }));
    await page.getByLabel("Name of this key").fill("Backup key");
    await page.getByRole("button", { name: "Register a security key" }).click();
    await shown(page.getByText("is registered", { exact: false }));
    const newKey = fixtures.state.keys[fixtures.state.keys.length - 1]!;
    expect(newKey.name).toBe("Backup key");
    const [firstBefore, secondBefore] = [await signaturesOf(first), await signaturesOf(second)];
    // The browser still holds the first key's session: the sign-in page would show home and ask no key.
    expect((await context.cookies()).some((cookie) => cookie.name === "__Host-korbat_staff")).toBe(true);
    await page.getByRole("button", { name: "Sign in with this key" }).click();
    await shown(page.getByText("opened the console", { exact: false }));
    expect(await signaturesOf(second)).toBe(secondBefore + 1);
    expect(await signaturesOf(first)).toBe(firstBefore);
    // The session it opened is the new key's.
    expect([...fixtures.state.sessions.values()].filter((s) => s.credentialId === newKey.credentialId)).toHaveLength(1);
    await watcher.cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: first, enabled: true });
    await page.getByRole("link", { name: "Go to the home page" }).click();
    await shown(page.getByRole("heading", { name: "Home" }));
    await shown(page.locator("ul.signins"));
    await shown(page.locator("ul.keys"));
    await shown(page.getByRole("cell", { name: "This session" }));
    await clean();
  });

  test("sign-out ends the session and shows sign-in at its own address", async () => {
    const before = fixtures.state.sessions.size;
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(`${origin}/signin`);
    await shown(page.getByRole("button", { name: "Sign in with your staff key" }));
    expect(await page.getByText("Your staff session ended.").count()).toBe(0);
    // The session the page held, the second key's, is gone; the first key's, which this browser no longer names, stays.
    expect(fixtures.state.sessions.size).toBe(before - 1);
    expect([...fixtures.state.sessions.values()].some((s) => s.credentialId === fixtures.state.keys[fixtures.state.keys.length - 1]!.credentialId)).toBe(false);
    await clean();
  });

  test("sign-in options that carry a step-up challenge are refused before the key is asked", async () => {
    const before = await signatures();
    const served = fixtures.state.signInOptionsServed;
    const verifies = fixtures.state.requests.filter((r) => r.path === "/api/staff/signin/verify").length;
    fixtures.state.stepUpChallengeAtNextSignIn = true;
    await page.getByRole("button", { name: "Sign in with your staff key" }).click();
    await shown(page.getByText(messageFor("signin_mismatch")));
    expect(fixtures.state.signInOptionsServed).toBe(served + 1);
    // No key signed anything and nothing was sent after the options: the forged confirmation was never made.
    expect(await signatures()).toBe(before);
    expect(fixtures.state.requests.filter((r) => r.path === "/api/staff/signin/verify").length).toBe(verifies);
    expect(page.url()).toBe(`${origin}/signin`);
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

### Replace `apps/admin/test/browser/fixture-api.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CEREMONY_CHALLENGE,
  CHALLENGE_PURPOSES,
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
  type StaffErrorCode,
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
function flagRefusal(flags: number | null): "staff_key_refused" | "staff_key_not_user_verified" | "staff_key_not_device_bound" | null {
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

/**
 * The status the API answers each staff refusal with (apps/api/src/auth/staff/), so the console meets here what it meets
 * behind Caddy; a unit test (fixture-statuses.test.ts) checks it against the API's own source.
 */
export const REFUSAL_STATUS = {
  staff_enrollment_invalid: 400,
  staff_key_refused: 400,
  staff_key_invalid: 401,
  staff_session_required: 401,
  staff_key_not_user_verified: 403,
  staff_key_not_device_bound: 403,
  staff_key_suspended: 403,
  staff_step_up_required: 403,
  staff_step_up_invalid: 403,
  staff_key_limit: 409,
} as const satisfies Record<StaffErrorCode, number>;

class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly headers: Record<string, string | string[]> = {},
  ) {
    super(code);
  }
}

/** A staff refusal with the API's own status for its code. */
const refuse = (code: StaffErrorCode, headers: Record<string, string | string[]> = {}) => new Refusal(REFUSAL_STATUS[code], code, headers);

/**
 * A challenge in the other ceremonies' 58-byte layout (the contracts' CEREMONY_CHALLENGE), with the purpose's code, a
 * fresh nonce, `binding` (zeros for a sign-in, bound to nothing) and a random seal, since only this server reads it back.
 */
function ceremonyChallenge(purpose: "staff_signin" | "staff_register", binding: Buffer = Buffer.alloc(CEREMONY_CHALLENGE.bindingBytes)): string {
  const c = CEREMONY_CHALLENGE;
  const bytes = randomBytes(c.bytes);
  bytes[c.versionAt] = c.version;
  bytes[c.purposeAt] = CHALLENGE_PURPOSES[purpose];
  bytes.writeBigUInt64BE(BigInt(Date.now() + 10 * 60_000), c.expiryAt);
  binding.copy(bytes, c.bindingAt);
  return bytes.toString("base64url");
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
    /**
     * The next sign-in options carry a step-up challenge for an action of this server's choosing, as an API under an
     * attacker's control would hand out to have the key sign it at an ordinary sign-in.
     */
    stepUpChallengeAtNextSignIn: false,
    signInOptionsServed: 0,
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
  function clientData(encoded: string, type: "webauthn.create" | "webauthn.get", purpose: "register" | "signin" | "step_up", refusal: StaffErrorCode) {
    let data: { type?: unknown; challenge?: unknown; origin?: unknown };
    try {
      data = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      problem(`${type}: client data that is not JSON`);
      throw refuse(refusal);
    }
    const issued = typeof data.challenge === "string" ? state.challenges.get(data.challenge) : undefined;
    if (data.type !== type || data.origin !== state.origin || issued?.purpose !== purpose) {
      problem(`${type}: client data for ${String(data.type)} at ${String(data.origin)}, challenge ${issued ? issued.purpose : "unknown"}`);
      throw refuse(refusal);
    }
    state.challenges.delete(data.challenge as string);
    return issued;
  }

  /** The session the staff cookie names, as requireStaff reads it: never cached, refused with both cookies cleared. */
  function requireStaff(req: IncomingMessage): SessionRecord {
    const jar = cookies(req);
    const session = [...state.sessions.values()].find((s) => s.token === jar.get(SESSION_COOKIE));
    const at = Date.now();
    if (!session || at >= session.createdAt + ABSOLUTE_MS || at >= session.lastUsedAt + IDLE_MS) throw refuse("staff_session_required", { "set-cookie": CLEAR_COOKIES });
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
      if (input.token !== state.enrolmentToken || state.enrolmentUsed) throw refuse("staff_enrollment_invalid");
      // Bound, as the API binds it, to the enrolment's id, which the page is never told: random bytes stand for its hash.
      const challenge = ceremonyChallenge("staff_register", randomBytes(CEREMONY_CHALLENGE.bindingBytes));
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
      if (input.token !== state.enrolmentToken || state.enrolmentUsed) throw refuse("staff_enrollment_invalid");
      clientData(input.response.response.clientDataJSON, "webauthn.create", "register", "staff_key_refused");
      const refusal = flagRefusal(flagsOf(authDataOf(Buffer.from(input.response.response.attestationObject, "base64url"))));
      // A refusal leaves the link usable, so the person can try another key.
      if (refusal) throw refuse(refusal);
      state.enrolmentUsed = true;
      const stored: KeyRecord = { id: randomUUID(), name: input.name, createdAt: iso(Date.now()), lastUsedAt: null, credentialId: input.response.id };
      state.keys.push(stored);
      return { status: 200, body: { key: { id: stored.id, name: stored.name, createdAt: stored.createdAt, lastUsedAt: stored.lastUsedAt } } };
    }

    if (key === "POST /api/staff/signin/options") {
      if (body !== undefined) problem(`${key}: a body, where the route takes none`);
      state.signInOptionsServed += 1;
      if (state.stepUpChallengeAtNextSignIn) {
        state.stepUpChallengeAtNextSignIn = false;
        // The forged case: a step-up challenge for revoking one of the person's sessions, bound to a handle of this
        // server's choosing. Never recorded as issued, so an assertion made over it would be a problem here too.
        const victim = [...state.sessions.values()][0]?.handle ?? randomUUID();
        const challenge = await stepUpChallenge(randomUUID(), { action: "staff_session_revoked", target: { type: "staff_session", id: victim }, params: {} });
        return { status: 200, body: { options: { challenge, rpId: "localhost", timeout: 300_000, userVerification: "required", allowCredentials: [] } } };
      }
      const challenge = ceremonyChallenge("staff_signin");
      state.challenges.set(challenge, { purpose: "signin" });
      return { status: 200, body: { options: { challenge, rpId: "localhost", timeout: 300_000, userVerification: "required", allowCredentials: [] } } };
    }

    if (key === "POST /api/staff/signin/verify") {
      const input = parse(StaffSignInVerifyRequest, body, key);
      clientData(input.response.response.clientDataJSON, "webauthn.get", "signin", "staff_key_invalid");
      const staffKey = state.keys.find((k) => k.credentialId !== null && k.credentialId === input.response.id);
      if (!staffKey || input.response.response.userHandle !== userHandle) throw refuse("staff_key_invalid");
      const refusal = flagRefusal(flagsOf(Buffer.from(input.response.response.authenticatorData, "base64url")));
      // Read after the signature, as the API reads them; staff_key_refused stands for flags it cannot read at all.
      if (refusal) throw refuse(refusal === "staff_key_refused" ? "staff_key_invalid" : refusal);
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
      throw refuse("staff_step_up_invalid");
    }
    const refusal = flagRefusal(flagsOf(Buffer.from(stepUp.response.authenticatorData, "base64url")));
    if (refusal) throw refuse(refusal === "staff_key_refused" ? "staff_step_up_invalid" : refusal);
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
    /** A new enrolment link, as `staff.js enroll` prints one for the person's next key; its token. */
    issueEnrolment(): string {
      state.enrolmentToken = b64url(32);
      state.enrolmentUsed = false;
      return state.enrolmentToken;
    },
  };
}
```

### Replace `apps/admin/test/browser/watch.ts` (whole file)

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
 * Console errors the walk causes on purpose, which Chromium logs for every answer that is not a success, with the statuses
 * the API answers them with: 401 (no session, an ended session), 403 (a synced key refused at enrolment), 404 (the
 * console off), and 400 and 409, which the API answers other refusals of a key or a link with. What the page then shows
 * is checked step by step, and a request the fixtures refuse for the page's own fault is one of their problems.
 */
const EXPECTED_HTTP_ERROR = /^Failed to load resource: the server responded with a status of (400|401|403|404|409) /;
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

### Replace `apps/admin/test/enroll.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import { enrollKey, type SignalApi } from "../src/enroll";
import { CHALLENGE_PURPOSES } from "@korbat/contracts";
import { ceremonyChallenge, enrollOptions, envelope, fakeCredentials, fakeFetch, revokeAction, SESSION_HANDLE, stepUpChallenge } from "./fixtures";

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
    // The new credential's id comes back too: the success page's sign-in asks for that key alone.
    expect(await r.result).toEqual({ ok: true, key: KEY, credentialId: "bmV3LWtleQ" });
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

  // The page checks the challenge's layout and purpose before it asks for the key (3a design, section 9). It cannot check
  // the binding: that is the enrolment's id, which the page is never told.
  const mismatched: [string, () => Promise<string>][] = [
    ["a step-up challenge", () => stepUpChallenge(SESSION_HANDLE, revokeAction(SESSION_HANDLE))],
    ["a staff sign-in's challenge", async () => ceremonyChallenge()],
    ["a personal passkey's registration challenge", async () => ceremonyChallenge({ purpose: CHALLENGE_PURPOSES.register, binding: Buffer.alloc(16, 2) })],
    ["another version", async () => ceremonyChallenge({ purpose: CHALLENGE_PURPOSES.staff_register, version: 2, binding: Buffer.alloc(16, 2) })],
    ["one byte short", async () => ceremonyChallenge({ purpose: CHALLENGE_PURPOSES.staff_register, bytes: 57 })],
  ];
  for (const [name, make] of mismatched) {
    test(`options whose challenge is not a staff registration's are refused before the key is asked: ${name}`, async () => {
      const fake = fakeFetch({ "POST /api/staff/enroll/options": { status: 200, body: enrollOptions(false, await make()) } });
      const credentials = fakeCredentials();
      const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
      const result = await enrollKey({ api, credentials, signal: undefined }, { token: TOKEN, name: "Blue key", kind: "security_key" });
      expect(result).toEqual({ ok: false, code: "enroll_mismatch", status: 0, cleanup: "none" });
      expect(credentials.calls).toEqual([]);
      expect(fake.requests.map((q) => q.url)).toEqual(["/api/staff/enroll/options"]);
    });
  }

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

### Replace `apps/admin/test/fixtures.ts` (whole file)

```ts
import { CEREMONY_CHALLENGE, CHALLENGE_PURPOSES, STAFF_STEP_UP_CHALLENGE, stepUpActionHash, stepUpBinding, type StaffMe, type StaffStepUpOptionsRequest } from "@korbat/contracts";
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

/**
 * A challenge in the other ceremonies' 58-byte layout (the contracts' CEREMONY_CHALLENGE): a staff sign-in's unless told
 * another purpose, with a zero binding unless given one, and a seal the console cannot check. `bytes` cuts or pads it.
 */
export function ceremonyChallenge(options: { purpose?: number; version?: number; binding?: Buffer; bytes?: number } = {}): string {
  const c = CEREMONY_CHALLENGE;
  const bytes = Buffer.alloc(c.bytes, 7);
  bytes[c.versionAt] = options.version ?? c.version;
  bytes[c.purposeAt] = options.purpose ?? CHALLENGE_PURPOSES.staff_signin;
  bytes.writeBigUInt64BE(BigInt(Date.parse("2026-10-01T09:10:00.000Z")), c.expiryAt);
  (options.binding ?? Buffer.alloc(c.bindingBytes)).copy(bytes, c.bindingAt);
  const sized = options.bytes === undefined ? bytes : Buffer.concat([bytes, Buffer.alloc(Math.max(0, options.bytes - c.bytes), 1)]).subarray(0, options.bytes);
  return sized.toString("base64url");
}

/** A staff registration's challenge, bound (as the API binds it) to an enrolment's id the page is never told. */
export const registerChallenge = () => ceremonyChallenge({ purpose: CHALLENGE_PURPOSES.staff_register, binding: Buffer.alloc(16, 0x5e) });

/** Sign-in options as the API writes them: a staff sign-in challenge, user verification and an empty allow list. */
export function signInOptions(challenge: string = ceremonyChallenge()) {
  return { options: { challenge, rpId: "localhost", timeout: 300_000, userVerification: "required", allowCredentials: [] } };
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

/** Registration options as the API writes them for an enrolment; `challenge` replaces the staff registration's own. */
export function enrollOptions(rpShared: boolean, challenge: string = registerChallenge()) {
  return {
    options: {
      challenge,
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

### Replace `apps/admin/test/screens.test.tsx` (whole file)

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
  const base = { tokenValid: true, name: "", nameError: null, busy: null, result: null, check: { state: "none" }, onName: noop, onRegister: noop, onCheck: noop } as const;

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

  const registered = (name: string) => ({ ok: true as const, key: { id: "5b0e4a52-3c1d-4f6e-9a8b-7c6d5e4f3a2b", name, createdAt: "2026-10-01T09:00:00.000Z", lastUsedAt: null }, credentialId: "bmV3LWtleQ" });

  test("a registered key's name is text, and the page signs in with that key itself, never through the sign-in page", () => {
    for (const name of [HOSTILE.script, HOSTILE.img, HOSTILE.bidi]) {
      const out = html(<EnrollView {...base} result={registered(name)} />);
      expect(out).toMatch(/Sign in with it once/);
      expect(out).toContain(">Sign in with this key</button>");
      // The sign-in page would show home to a browser that already holds a staff session, and ask no key.
      expect(out).not.toContain('href="/signin"');
      expect(out).not.toMatch(/<(script|img)\b/);
      expect(out).toContain(`<bdi>`);
    }
  });

  test("the check after the enrolment: under way, opened the console, or failed with the operator to tell", () => {
    const busy = html(<EnrollView {...base} result={registered("Blue key")} check={{ state: "busy" }} />);
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"|<button[^>]*aria-busy="true"[^>]*disabled=""/);
    const opened = html(<EnrollView {...base} result={registered(HOSTILE.script)} check={{ state: "opened" }} />);
    expect(opened).toMatch(/opened the console/);
    expect(opened).toContain(HOSTILE_ESCAPED.script);
    expect(hrefs(opened)).toEqual(["/"]);
    expect(opened).not.toContain(">Sign in with this key</button>");
    const failed = html(<EnrollView {...base} result={registered("Blue key")} check={{ state: "failed", message: "This key does not open the staff console." }} />);
    expect(failed).toContain("This key does not open the staff console.");
    expect(failed).toMatch(/tell the operator at once/);
    // The person may try again: a closed prompt is no verdict on the key.
    expect(failed).toContain(">Sign in with this key</button>");
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
    const out = html(<AuditView {...props} at={120} place="120" />);
    expect(out).toContain(">Newest</button>");
    expect(out).toContain("From place 120, newest first.");
    expect(html(<AuditView {...props} place="abc" placeError="Enter a place: a whole number from 1." />)).toContain("Enter a place: a whole number from 1.");
  });
});

describe("a place that names no row", () => {
  const props = { hasOlder: false, loadingOlder: false, place: "", placeError: null, error: null, onLoadOlder: noop, onPlace: noop, onGoToPlace: noop, onNewest: noop };
  const row = (seq: number): AuditEntry => ({ seq, hash: "c".repeat(64), createdAt: "2026-10-01T09:00:05.000Z", actorHandle: null, action: "staff_sign_in", targetType: null, targetId: null, actionHash: null });

  test("a place beyond the newest row: the page says there is no row there, and never that it starts there", () => {
    // The reader answers a place beyond the head with the newest page: after a restore, or the newest rows deleted.
    const out = html(<AuditView {...props} at={5000} page={{ state: "ready", value: [row(4800), row(4799)] }} />);
    expect(out).toContain("There is no row at place 5000");
    expect(out).toContain("4800");
    expect(out).toMatch(/tell the operator/);
    expect(out).toMatch(/role="alert"/);
    expect(out).not.toContain("From place 5000");
  });

  test("an empty log, opened at a place", () => {
    const out = html(<AuditView {...props} at={7} page={{ state: "ready", value: [] }} />);
    expect(out).toContain("There is no row at place 7");
    expect(out).not.toContain("From place 7");
  });

  test("while the page loads, nothing is said about the place", () => {
    const out = html(<AuditView {...props} at={7} page={{ state: "loading" }} />);
    expect(out).not.toContain("There is no row");
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

### Replace `apps/admin/test/source.test.ts` (whole file)

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

describe("the key is asked only after the console checked what it is asked to sign", () => {
  test("navigator.credentials is called only by the three ceremonies, each of which checks its challenge first", () => {
    // A fourth call site would need a check of its own (3a design, section 9): this list makes adding one a decision.
    expect(findInSource(/credentials\.(get|create)\(/).map((found) => found.split(":")[0])).toEqual(["src/enroll.ts", "src/sign-in.ts", "src/step-up.ts"]);
    const checks: [string, RegExp][] = [
      ["enroll.ts", /checkRegisterChallenge\(/],
      ["sign-in.ts", /checkSignInChallenge\(/],
      ["step-up.ts", /checkStepUpOptions\(/],
    ];
    for (const [file, check] of checks) {
      const source = readFileSync(path.join(SRC, file), "utf8");
      const call = source.search(/credentials\.(get|create)\(/);
      // The check is called in the function that makes the call, before it, as it runs before it. Only that function's
      // text up to the call is searched: a check declared in the same file (step-up.ts declares checkStepUpOptions) is
      // another top-level function, so its name there never stands in for the call.
      const declarations = [...source.matchAll(/^(export )?(async )?function \w+/gm)].map((found) => found.index ?? -1);
      const enclosing = Math.max(...declarations.filter((at) => at < call));
      expect(call, file).toBeGreaterThan(-1);
      expect(enclosing, file).toBeGreaterThan(-1);
      expect(source.slice(enclosing, call).search(check), file).toBeGreaterThan(-1);
    }
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

### Replace `apps/admin/test/step-up.test.ts` (whole file)

```ts
import { STAFF_STEP_UP_CHALLENGE } from "@korbat/contracts";
import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import { checkStepUpOptions, revokeSessionWithKey, sessionRevokeAction, StepUpMismatch } from "../src/step-up";
import { envelope, fakeCredentials, fakeFetch, makeMe, OTHER_SESSION, revokeAction, SESSION_HANDLE, stepUpChallenge, stepUpOptions } from "./fixtures";

/**
 * The check of step-up options before the key is asked (3a design, section 9): the challenge must be the 74 bytes of the
 * contracts' layout with the staff_step_up purpose, bound to this session's handle and the hash of exactly the action the
 * page chose, and the allow list must hold one key; otherwise navigator.credentials.get is never called.
 */
const TARGET = "4f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
const THIRD = "0d4c7b9e-1f36-4e2d-9a10-6c3b4f5e8a21";
const action = revokeAction(TARGET);

/**
 * The whole confirmation as the home screen runs it, over a fake API whose /me names the session `current` (this page's,
 * unless another tab has since signed in again) and that answers the step-up options with `options`.
 */
async function revokeWith(options: unknown, current = SESSION_HANDLE) {
  const fake = fakeFetch({
    "GET /api/staff/me": { status: 200, body: makeMe({ sessionHandle: current }) },
    "POST /api/staff/step-up/options": { status: 200, body: options },
    [`DELETE /api/staff/sessions/${TARGET}`]: { status: 204 },
  });
  const credentials = fakeCredentials();
  const api = createStaffApi({ fetch: fake.fetch, cookie: () => "__Host-korbat_staff_csrf=t" });
  const outcome = await revokeSessionWithKey({ api, credentials }, TARGET).catch((err: unknown) => err);
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
      // The session was read and the options were asked for, and nothing was sent after them.
      expect(run.requests.map((r) => `${r.method} ${r.url}`)).toEqual(["GET /api/staff/me", "POST /api/staff/step-up/options"]);
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
      "GET /api/staff/me 1",
      "POST /api/staff/step-up/options 1",
      `DELETE /api/staff/sessions/${TARGET} 1`,
    ]);
    expect(run.requests[1]!.body).toEqual(action);
    expect(run.requests[2]!.body).toMatchObject({ stepUp: { id: "Y3JlZGVudGlhbC0x", type: "public-key" } });
    expect(Object.keys(run.requests[2]!.body as object)).toEqual(["stepUp"]);
  });

  test("the binding is checked against the session the browser's cookie names now, read right before the options", async () => {
    // Another tab signed out and in again: the cookie now names another session, and the API binds the options to it. The
    // page reads /me first, so an honest API's options pass and the key is asked; the tamper message stays for tampering.
    const run = await revokeWith(stepUpOptions(await stepUpChallenge(OTHER_SESSION, action)), OTHER_SESSION);
    expect(run.outcome).toBe("revoked");
    expect(run.credentials.calls.map((c) => c.kind)).toEqual(["get"]);
    // Options bound to the session the page opened with, which the cookie no longer names, are refused.
    const stale = await revokeWith(stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action)), OTHER_SESSION);
    expect(stale.outcome).toBeInstanceOf(StepUpMismatch);
    expect(stale.credentials.calls).toEqual([]);
  });

  test("a session already gone is no error", async () => {
    const fake = fakeFetch({
      "GET /api/staff/me": { status: 200, body: makeMe() },
      "POST /api/staff/step-up/options": { status: 200, body: stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action)) },
      [`DELETE /api/staff/sessions/${TARGET}`]: { status: 404, body: envelope("not_found") },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    await expect(revokeSessionWithKey({ api, credentials: fakeCredentials() }, TARGET)).resolves.toBe("gone");
  });

  test("a confirmation the API refuses is its error", async () => {
    const fake = fakeFetch({
      "GET /api/staff/me": { status: 200, body: makeMe() },
      "POST /api/staff/step-up/options": { status: 200, body: stepUpOptions(await stepUpChallenge(SESSION_HANDLE, action)) },
      [`DELETE /api/staff/sessions/${TARGET}`]: { status: 403, body: envelope("staff_step_up_invalid") },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    await expect(revokeSessionWithKey({ api, credentials: fakeCredentials() }, TARGET)).rejects.toMatchObject({ code: "staff_step_up_invalid" });
  });
});
```

### Replace `apps/admin/test/store.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { createStaffApi } from "../src/api";
import { createConsoleStore, type ConsoleState } from "../src/store";
import { envelope, FakeClock, fakeFetch, makeMe, OTHER_SESSION, settle } from "./fixtures";

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

  test("every /me a screen reads becomes the page's session, so the step-up binds to the session the cookie names now", async () => {
    // Another tab signed out and in again, and its new session's cookie replaced this page's: the next /me names it.
    const s = setup("/", { "GET /api/staff/me": [{ status: 200, body: makeMe() }, { status: 200, body: makeMe({ sessionHandle: OTHER_SESSION }) }] });
    await s.store.start();
    await s.store.api.me({ activity: true });
    expect(s.store.get().session).toEqual({ kind: "signed-in", me: makeMe({ sessionHandle: OTHER_SESSION }) });
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

### Replace `apps/admin/test/webauthn.test.ts` (whole file)

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
    expect(bytes(options.challenge)).toEqual(Buffer.from(json.challenge, "base64url"));
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

  test("registration asks for no attestation and no extension but credProps, whatever the options said", () => {
    // An API under an attacker's control asking for the key's make and model, and for extensions the design never uses.
    const json = { ...enrollOptions(false).options, attestation: "direct", extensions: { credProps: true, largeBlob: { support: "required" }, prf: {} } };
    const options = creationOptionsFromJSON(json);
    expect(options.attestation).toBe("none");
    expect(options.extensions).toEqual({ credProps: true });
    // Without credProps in the options, no extension at all.
    const bare = creationOptionsFromJSON({ ...json, extensions: { largeBlob: { support: "required" } } });
    expect(bare.attestation).toBe("none");
    expect(bare.extensions).toBeUndefined();
  });

  test("an assertion passes on no extension, whatever the options said", () => {
    const json = { ...stepUpOptions("AAAA").options, extensions: { largeBlob: { read: true }, prf: { eval: { first: "AAAA" } }, appid: "https://evil.example" } };
    const options = requestOptionsFromJSON(json);
    expect(options.extensions).toBeUndefined();
    expect(Object.keys(options).sort()).toEqual(["allowCredentials", "challenge", "rpId", "timeout", "userVerification"]);
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

### Replace `apps/api/test/auth/passkey-challenge.test.ts` (whole file)

```ts
import { createHash, createHmac, hkdfSync } from "node:crypto";
import { describe, expect, test } from "vitest";
import { CEREMONY_CHALLENGE, CHALLENGE_PURPOSES, STAFF_STEP_UP_CHALLENGE, stepUpActionHash, stepUpBinding } from "@korbat/contracts";
import { AuthError } from "../../src/auth/context";
import { sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { HOUR, MINUTE } from "../../src/auth/limits";
import {
  CHALLENGE_TTL_MS,
  STEP_UP_READ_MARGIN_MS,
  challengeKey,
  issueChallenge,
  issueStepUpChallenge,
  readChallenge,
  readStepUpChallenge,
  spendChallenge,
  type ChallengePurpose,
} from "../../src/auth/passkeys/challenge";

const AUTH_HMAC_KEY = Buffer.alloc(32, 3);
const KEY = challengeKey(AUTH_HMAC_KEY);
const T0 = 1_789_000_000_000;
const at = (ms: number) => new Date(T0 + ms);
const HANDLE = "0b7f3c4e-2a51-4c8e-9d7a-5b1e6f2c3d4a";
const OTHER_HANDLE = "7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36";
/** A staff enrolment's id, which a staff registration challenge is bound to (3a design, section 5). */
const ENROLMENT = "5d0c8e2f-9a41-4b7e-8c3d-2f6a1e9b7c05";
const OTHER_ENROLMENT = "a83f1c62-0e5d-4f9b-b217-6d4e9c0a3b18";
const PURPOSES: ChallengePurpose[] = ["signin", "register", "reauth", "staff_signin", "staff_register"];
/** The purposes whose challenge binds nothing: the two sign-ins, which run before any session or enrolment is known. */
const UNBOUND: ChallengePurpose[] = ["signin", "staff_signin"];
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const bytesOf = (challenge: string) => Buffer.from(challenge, "base64url");
const mac = (first42: Buffer) => createHmac("sha256", KEY).update(first42).digest().subarray(0, 16);
/** Seals 42 bytes as the codec does, so a test can build a challenge whose MAC holds while a field inside it is wrong. */
const sealed = (first42: Buffer) => Buffer.concat([first42, mac(first42)]).toString("base64url");
const spentKey = (challenge: string) => `webauthn-used:${sha256Hex(challenge)}`;

/** The AuthError a synchronous call throws; anything else fails the test. */
function refusal(read: () => unknown): AuthError {
  try {
    read();
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the challenge to be refused");
}

/** The AuthError a promise rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the challenge to be refused");
}

function expectInvalid(read: () => unknown) {
  const err = refusal(read);
  expect([err.code, err.status]).toEqual(["passkey_invalid", 401]);
}

describe("passkey challenges: the key", () => {
  test("is HKDF-SHA256 of AUTH_HMAC_KEY with an empty salt and the korbat-webauthn-challenge label, derived once per key", () => {
    expect(KEY.equals(Buffer.from(hkdfSync("sha256", AUTH_HMAC_KEY, "", "korbat-webauthn-challenge", 32)))).toBe(true);
    expect(KEY).toHaveLength(32);
    expect(KEY.equals(AUTH_HMAC_KEY)).toBe(false);
    // The same buffer comes back, so the flows can ask for it on every request without deriving it again.
    expect(challengeKey(AUTH_HMAC_KEY)).toBe(KEY);
    expect(challengeKey(Buffer.alloc(32, 4)).equals(KEY)).toBe(false);
  });
});

describe("passkey challenges: issuing and reading", () => {
  test("lays out 58 bytes: version, purpose, expiry, nonce, binding and an HMAC over the first 42, as unpadded base64url", () => {
    const cases: [ChallengePurpose, number, string | undefined][] = [
      ["signin", 1, undefined],
      ["register", 2, HANDLE],
      ["reauth", 3, HANDLE],
      // The staff console's two purposes share the layout, the key, the lifetime and the used-challenge markers.
      ["staff_signin", 4, undefined],
      ["staff_register", 5, ENROLMENT],
    ];
    for (const [purpose, code, bind] of cases) {
      const challenge = issueChallenge(KEY, purpose, at(0), bind);
      expect(challenge).toMatch(/^[A-Za-z0-9_-]{78}$/);
      const bytes = bytesOf(challenge);
      expect(bytes).toHaveLength(58);
      expect(bytes[0]).toBe(1);
      expect(bytes[1]).toBe(code);
      expect(Number(bytes.readBigUInt64BE(2))).toBe(T0 + 10 * MINUTE);
      const binding = bind === undefined ? Buffer.alloc(16) : createHash("sha256").update(bind).digest().subarray(0, 16);
      expect(bytes.subarray(26, 42).equals(binding)).toBe(true);
      expect(bytes.subarray(42).equals(mac(bytes.subarray(0, 42)))).toBe(true);
      expect(() => readChallenge(KEY, challenge, purpose, at(0), bind)).not.toThrow();
    }
    expect(CHALLENGE_TTL_MS).toBe(10 * MINUTE);
  });

  test("writes the contracts' layout and purpose codes, which the console checks before it asks for the key", () => {
    const c = CEREMONY_CHALLENGE;
    for (const purpose of PURPOSES) {
      const bind = UNBOUND.includes(purpose) ? undefined : ENROLMENT;
      const challenge = issueChallenge(KEY, purpose, at(0), bind);
      expect(challenge).toHaveLength(c.encodedLength);
      const bytes = bytesOf(challenge);
      expect(bytes).toHaveLength(c.bytes);
      expect([bytes[c.versionAt], bytes[c.purposeAt]]).toEqual([c.version, CHALLENGE_PURPOSES[purpose]]);
      const binding = bind === undefined ? Buffer.alloc(c.bindingBytes) : createHash("sha256").update(bind).digest().subarray(0, c.bindingBytes);
      expect(bytes.subarray(c.bindingAt, c.bindingAt + c.bindingBytes).equals(binding)).toBe(true);
      expect(bytes.subarray(c.sealAt).equals(mac(bytes.subarray(0, c.sealAt)))).toBe(true);
    }
  });

  test("draws a fresh 16-byte nonce for every challenge", () => {
    const a = bytesOf(issueChallenge(KEY, "signin", at(0)));
    const b = bytesOf(issueChallenge(KEY, "signin", at(0)));
    expect(a.subarray(0, 10).equals(b.subarray(0, 10))).toBe(true);
    expect(a.subarray(10, 26).equals(b.subarray(10, 26))).toBe(false);
    expect(a.subarray(26, 42).equals(b.subarray(26, 42))).toBe(true);
  });

  test("refuses every tampered byte, the expiry and the MAC included, as passkey_invalid", () => {
    const challenge = issueChallenge(KEY, "reauth", at(0), HANDLE);
    for (let i = 0; i < 58; i++) {
      const bytes = bytesOf(challenge);
      bytes[i] = bytes[i]! ^ 0x01;
      expectInvalid(() => readChallenge(KEY, bytes.toString("base64url"), "reauth", at(0), HANDLE));
    }
  });

  test("refuses a challenge sealed with another key", () => {
    const foreign = issueChallenge(challengeKey(Buffer.alloc(32, 4)), "signin", at(0));
    expectInvalid(() => readChallenge(KEY, foreign, "signin", at(0)));
  });

  test("refuses anything that is not exactly 58 bytes of canonical, unpadded base64url", () => {
    const challenge = issueChallenge(KEY, "signin", at(0));
    const bytes = bytesOf(challenge);
    // Node's decoder ignores the 4 spare bits of the last character: this other string names the very same 58 bytes.
    const last = BASE64URL_ALPHABET.indexOf(challenge.at(-1)!);
    const nonCanonical = challenge.slice(0, -1) + BASE64URL_ALPHABET[last | 1];
    expect(nonCanonical).not.toBe(challenge);
    expect(bytesOf(nonCanonical).equals(bytes)).toBe(true);
    const malformed = [
      "",
      bytes.subarray(0, 57).toString("base64url"),
      Buffer.concat([bytes, Buffer.from([0])]).toString("base64url"),
      `${challenge}==`,
      bytes.toString("base64"),
      `+${challenge.slice(1)}`,
      ` ${challenge.slice(1)}`,
      nonCanonical,
      "A".repeat(10_000),
    ];
    for (const candidate of malformed) expectInvalid(() => readChallenge(KEY, candidate, "signin", at(0)));
  });

  test("refuses a sealed challenge of another version or with an unknown purpose byte", () => {
    const first42 = bytesOf(issueChallenge(KEY, "signin", at(0))).subarray(0, 42);
    const version2 = Buffer.from(first42);
    version2[0] = 2;
    expectInvalid(() => readChallenge(KEY, sealed(version2), "signin", at(0)));
    // 4 and 5 are the staff console's purposes, which the purpose tests below cover.
    for (const purpose of [0, 99, 255]) {
      const unknown = Buffer.from(first42);
      unknown[1] = purpose;
      expectInvalid(() => readChallenge(KEY, sealed(unknown), "signin", at(0)));
    }
    // The helper seals exactly as the codec does: with the right fields its output reads.
    expect(() => readChallenge(KEY, sealed(Buffer.from(first42)), "signin", at(0))).not.toThrow();
  });

  test("refuses a challenge issued for another purpose", () => {
    for (const issued of PURPOSES) {
      const bind = UNBOUND.includes(issued) ? undefined : HANDLE;
      const challenge = issueChallenge(KEY, issued, at(0), bind);
      for (const expected of PURPOSES.filter((p) => p !== issued)) expectInvalid(() => readChallenge(KEY, challenge, expected, at(0), bind));
    }
  });

  test("refuses a challenge bound to another session's handle, and a bound one where none is expected", () => {
    const challenge = issueChallenge(KEY, "reauth", at(0), HANDLE);
    expectInvalid(() => readChallenge(KEY, challenge, "reauth", at(0), OTHER_HANDLE));
    expectInvalid(() => readChallenge(KEY, challenge, "reauth", at(0)));
    expect(() => readChallenge(KEY, challenge, "reauth", at(0), HANDLE)).not.toThrow();
  });

  test("refuses a sign-in challenge, whose binding is zeros, where a binding is expected", () => {
    const signin = issueChallenge(KEY, "signin", at(0));
    expectInvalid(() => readChallenge(KEY, signin, "signin", at(0), HANDLE));
    expectInvalid(() => readChallenge(KEY, signin, "reauth", at(0), HANDLE));
    expectInvalid(() => readChallenge(KEY, signin, "register", at(0), HANDLE));
    // An unbound challenge of the right purpose is refused on its binding alone.
    const unbound = issueChallenge(KEY, "register", at(0));
    expectInvalid(() => readChallenge(KEY, unbound, "register", at(0), HANDLE));
  });

  test("expires exactly ten minutes after it was issued, as challenge_expired", () => {
    const challenge = issueChallenge(KEY, "register", at(0), HANDLE);
    expect(() => readChallenge(KEY, challenge, "register", at(CHALLENGE_TTL_MS - 1), HANDLE)).not.toThrow();
    for (const when of [CHALLENGE_TTL_MS, CHALLENGE_TTL_MS + 1, HOUR]) {
      const err = refusal(() => readChallenge(KEY, challenge, "register", at(when), HANDLE));
      expect([err.code, err.status]).toEqual(["challenge_expired", 400]);
    }
  });

  test("checks the seal, the purpose and the binding before the expiry, so an expired forgery is still passkey_invalid", () => {
    const challenge = issueChallenge(KEY, "register", at(0), HANDLE);
    const late = at(HOUR);
    const tampered = bytesOf(challenge);
    tampered[20] = tampered[20]! ^ 0x80;
    expectInvalid(() => readChallenge(KEY, tampered.toString("base64url"), "register", late, HANDLE));
    expectInvalid(() => readChallenge(KEY, challenge, "reauth", late, HANDLE));
    expectInvalid(() => readChallenge(KEY, challenge, "register", late, OTHER_HANDLE));
  });
});

describe("passkey challenges: the staff console's purposes", () => {
  test("an app sign-in challenge does not open the console's sign-in, and a console sign-in challenge does not sign into the app", () => {
    const app = issueChallenge(KEY, "signin", at(0));
    const staff = issueChallenge(KEY, "staff_signin", at(0));
    expectInvalid(() => readChallenge(KEY, app, "staff_signin", at(0)));
    expectInvalid(() => readChallenge(KEY, staff, "signin", at(0)));
    expect(() => readChallenge(KEY, app, "signin", at(0))).not.toThrow();
    expect(() => readChallenge(KEY, staff, "staff_signin", at(0))).not.toThrow();
  });

  test("a personal passkey's registration challenge does not enrol a staff key, nor the reverse, whatever they are bound to", () => {
    const personal = issueChallenge(KEY, "register", at(0), ENROLMENT);
    const staff = issueChallenge(KEY, "staff_register", at(0), HANDLE);
    expectInvalid(() => readChallenge(KEY, personal, "staff_register", at(0), ENROLMENT));
    expectInvalid(() => readChallenge(KEY, staff, "register", at(0), HANDLE));
  });

  test("a staff registration challenge is bound to its enrolment's id, and refused for another enrolment or none", () => {
    const challenge = issueChallenge(KEY, "staff_register", at(0), ENROLMENT);
    // The binding takes any string: the first 16 bytes of the sha256 of the enrolment's id, as of a session's handle.
    expect(bytesOf(challenge).subarray(26, 42).equals(createHash("sha256").update(ENROLMENT).digest().subarray(0, 16))).toBe(true);
    expect(() => readChallenge(KEY, challenge, "staff_register", at(0), ENROLMENT)).not.toThrow();
    expectInvalid(() => readChallenge(KEY, challenge, "staff_register", at(0), OTHER_ENROLMENT));
    expectInvalid(() => readChallenge(KEY, challenge, "staff_register", at(0)));
    // An unbound one of the right purpose names no enrolment.
    expectInvalid(() => readChallenge(KEY, issueChallenge(KEY, "staff_register", at(0)), "staff_register", at(0), ENROLMENT));
  });

  test("a staff sign-in challenge binds nothing, and is refused where a binding is expected", () => {
    const challenge = issueChallenge(KEY, "staff_signin", at(0));
    expect(bytesOf(challenge).subarray(26, 42).equals(Buffer.alloc(16))).toBe(true);
    expectInvalid(() => readChallenge(KEY, challenge, "staff_signin", at(0), HANDLE));
  });

  test("the staff purposes expire after ten minutes as challenge_expired, and are spent once", async () => {
    const challenge = issueChallenge(KEY, "staff_register", at(0), ENROLMENT);
    expect(() => readChallenge(KEY, challenge, "staff_register", at(CHALLENGE_TTL_MS - 1), ENROLMENT)).not.toThrow();
    expect(refusal(() => readChallenge(KEY, challenge, "staff_register", at(CHALLENGE_TTL_MS), ENROLMENT)).code).toBe("challenge_expired");
    const kv = new MemoryKv(() => T0);
    await spendChallenge(kv, challenge, at(0));
    expect((await failure(spendChallenge(kv, challenge, at(0)))).code).toBe("passkey_invalid");
  });
});

describe("passkey challenges: the step-up layout", () => {
  const LF = String.fromCharCode(10);
  /** 3a's one step-up action on a staff session, and variations of each part it binds. */
  const revoke = { action: "staff_session_revoked", target: { type: "staff_session", id: OTHER_HANDLE }, params: {} };
  const L = STAFF_STEP_UP_CHALLENGE;
  /** Seals 58 bytes as the codec does for a step-up challenge. */
  const sealedStepUp = (first58: Buffer) => Buffer.concat([first58, mac(first58)]).toString("base64url");

  test("lays out 74 bytes at the contracts' offsets: version, the step-up purpose, expiry, nonce, the full 32-byte binding and an HMAC over the first 58", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{99}$/);
    expect(challenge).toHaveLength(L.encodedLength);
    const bytes = bytesOf(challenge);
    expect(bytes).toHaveLength(74);
    expect(bytes[L.versionAt]).toBe(1);
    expect(bytes[L.purposeAt]).toBe(6);
    expect(Number(bytes.readBigUInt64BE(L.expiryAt))).toBe(T0 + 10 * MINUTE);
    // The binding is every byte of the sha256 of the session's handle, a newline and the action's hash, not a prefix.
    const binding = createHash("sha256").update(`${HANDLE}${LF}${actionHash}`).digest();
    expect(bytes.subarray(L.bindingAt, L.sealAt).equals(binding)).toBe(true);
    expect(bytes.subarray(L.bindingAt, L.sealAt).equals(Buffer.from(await stepUpBinding(HANDLE, actionHash)))).toBe(true);
    expect(bytes.subarray(L.sealAt).equals(mac(bytes.subarray(0, L.sealAt)))).toBe(true);
    expect(() => readStepUpChallenge(KEY, challenge, at(0), HANDLE, actionHash)).not.toThrow();
  });

  test("draws a fresh nonce for every challenge", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const a = bytesOf(issueStepUpChallenge(KEY, at(0), HANDLE, actionHash));
    const b = bytesOf(issueStepUpChallenge(KEY, at(0), HANDLE, actionHash));
    expect(a.subarray(L.nonceAt, L.bindingAt).equals(b.subarray(L.nonceAt, L.bindingAt))).toBe(false);
    expect(a.subarray(L.bindingAt, L.sealAt).equals(b.subarray(L.bindingAt, L.sealAt))).toBe(true);
  });

  test("is refused for another session, another action, another target or other params", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    expectInvalid(() => readStepUpChallenge(KEY, challenge, at(0), OTHER_HANDLE, actionHash));
    const others = [
      { ...revoke, action: "staff_key_revoked" },
      { ...revoke, target: { type: "staff_session", id: HANDLE } },
      { ...revoke, target: { type: "staff_key", id: OTHER_HANDLE } },
      // 3a's one action has empty params, so other params never reach the binding over HTTP: they are tested here.
      { ...revoke, params: { all: true } },
      { ...revoke, params: { reason: "R2", items: [1, 2] } },
    ];
    for (const other of others) {
      const otherHash = await stepUpActionHash(other);
      expect(otherHash).not.toBe(actionHash);
      expectInvalid(() => readStepUpChallenge(KEY, challenge, at(0), HANDLE, otherHash));
    }
  });

  test("is refused by every other ceremony, and no other ceremony's challenge is read as a step-up", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const stepUp = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    for (const purpose of PURPOSES) {
      expectInvalid(() => readChallenge(KEY, stepUp, purpose, at(0), UNBOUND.includes(purpose) ? undefined : HANDLE));
      const other = issueChallenge(KEY, purpose, at(0), UNBOUND.includes(purpose) ? undefined : HANDLE);
      expectInvalid(() => readStepUpChallenge(KEY, other, at(0), HANDLE, actionHash));
    }
  });

  test("refuses every tampered byte, a challenge sealed with another key, and one of another version or purpose", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    for (let i = 0; i < L.bytes; i++) {
      const bytes = bytesOf(challenge);
      bytes[i] = bytes[i]! ^ 0x01;
      expectInvalid(() => readStepUpChallenge(KEY, bytes.toString("base64url"), at(0), HANDLE, actionHash));
    }
    expectInvalid(() => readStepUpChallenge(KEY, issueStepUpChallenge(challengeKey(Buffer.alloc(32, 4)), at(0), HANDLE, actionHash), at(0), HANDLE, actionHash));
    const first58 = bytesOf(challenge).subarray(0, L.sealAt);
    for (const [at_, value] of [
      [L.versionAt, 2],
      [L.purposeAt, 1],
      [L.purposeAt, 5],
      [L.purposeAt, 7],
    ] as const) {
      const changed = Buffer.from(first58);
      changed[at_] = value;
      expectInvalid(() => readStepUpChallenge(KEY, sealedStepUp(changed), at(0), HANDLE, actionHash));
    }
    // The helper seals exactly as the codec does: with the right fields its output reads.
    expect(() => readStepUpChallenge(KEY, sealedStepUp(Buffer.from(first58)), at(0), HANDLE, actionHash)).not.toThrow();
  });

  test("refuses anything that is not exactly 74 bytes of canonical, unpadded base64url", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    const bytes = bytesOf(challenge);
    // 74 bytes leave 4 spare bits in the last character, which Node's decoder ignores.
    const last = BASE64URL_ALPHABET.indexOf(challenge.at(-1)!);
    const nonCanonical = challenge.slice(0, -1) + BASE64URL_ALPHABET[last | 1];
    expect(bytesOf(nonCanonical).equals(bytes)).toBe(true);
    for (const candidate of [
      "",
      bytes.subarray(0, 73).toString("base64url"),
      Buffer.concat([bytes, Buffer.from([0])]).toString("base64url"),
      `${challenge}=`,
      bytes.toString("base64"),
      nonCanonical,
      "A".repeat(10_000),
    ]) {
      expectInvalid(() => readStepUpChallenge(KEY, candidate, at(0), HANDLE, actionHash));
    }
  });

  test("carries an expiry ten minutes after it was issued, but is read only while a minute of that is left: challenge_expired, checked after the seal and the binding", async () => {
    const actionHash = await stepUpActionHash(revoke);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, actionHash);
    // The expiry it carries, which audit-verify compares with the row's time, is the full ten minutes.
    expect(Number(bytesOf(challenge).readBigUInt64BE(L.expiryAt))).toBe(T0 + CHALLENGE_TTL_MS);
    expect(STEP_UP_READ_MARGIN_MS).toBe(MINUTE);
    expect(() => readStepUpChallenge(KEY, challenge, at(CHALLENGE_TTL_MS - STEP_UP_READ_MARGIN_MS - 1), HANDLE, actionHash)).not.toThrow();
    for (const late of [CHALLENGE_TTL_MS - STEP_UP_READ_MARGIN_MS, CHALLENGE_TTL_MS - 1, CHALLENGE_TTL_MS]) {
      const err = refusal(() => readStepUpChallenge(KEY, challenge, at(late), HANDLE, actionHash));
      expect([late, err.code, err.status]).toEqual([late, "challenge_expired", 400]);
    }
    // An expired challenge for another session is still passkey_invalid: nothing tells which field failed first.
    expectInvalid(() => readStepUpChallenge(KEY, challenge, at(HOUR), OTHER_HANDLE, actionHash));
  });

  test("is spent once through the same used-challenge markers, for the rest of its life", async () => {
    let clock = T0;
    const kv = new MemoryKv(() => clock);
    const challenge = issueStepUpChallenge(KEY, at(0), HANDLE, await stepUpActionHash(revoke));
    await spendChallenge(kv, challenge, at(0));
    expect(await kv.get(spentKey(challenge))).toBe("1");
    expect((await failure(spendChallenge(kv, challenge, at(0)))).code).toBe("passkey_invalid");
    clock = T0 + CHALLENGE_TTL_MS;
    expect(await kv.get(spentKey(challenge))).toBeNull();
    expect((await failure(spendChallenge(kv, challenge, at(CHALLENGE_TTL_MS)))).code).toBe("challenge_expired");
  });
});

describe("passkey challenges: single use", () => {
  test("a challenge is spent once, and its marker lives exactly as long as the challenge", async () => {
    let clock = T0;
    const kv = new MemoryKv(() => clock);
    const challenge = issueChallenge(KEY, "signin", at(0));
    clock = T0 + MINUTE;
    await spendChallenge(kv, challenge, at(MINUTE));
    expect(await kv.get(spentKey(challenge))).toBe("1");
    const second = await failure(spendChallenge(kv, challenge, at(MINUTE)));
    expect([second.code, second.status]).toEqual(["passkey_invalid", 401]);
    clock = T0 + CHALLENGE_TTL_MS - 1;
    expect(await kv.get(spentKey(challenge))).toBe("1");
    expect((await failure(spendChallenge(kv, challenge, at(CHALLENGE_TTL_MS - 1)))).code).toBe("passkey_invalid");
    // Past its expiry the challenge is refused by readChallenge, so the marker has nothing left to guard.
    clock = T0 + CHALLENGE_TTL_MS;
    expect(await kv.get(spentKey(challenge))).toBeNull();
  });

  test("two concurrent spends of the same challenge: exactly one wins", async () => {
    const kv = new MemoryKv(() => T0);
    const challenge = issueChallenge(KEY, "reauth", at(0), HANDLE);
    const results = await Promise.allSettled([spendChallenge(kv, challenge, at(0)), spendChallenge(kv, challenge, at(0))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AuthError);
    expect((rejected[0]!.reason as AuthError).code).toBe("passkey_invalid");
  });

  test("spending at or after the expiry is challenge_expired and writes no marker", async () => {
    const kv = new MemoryKv(() => T0 + CHALLENGE_TTL_MS);
    const challenge = issueChallenge(KEY, "signin", at(0));
    const err = await failure(spendChallenge(kv, challenge, at(CHALLENGE_TTL_MS)));
    expect([err.code, err.status]).toEqual(["challenge_expired", 400]);
    expect(await kv.get(spentKey(challenge))).toBeNull();
  });

  test("a malformed or non-canonical string cannot be spent, so it can never mark a second copy of a challenge", async () => {
    const kv = new MemoryKv(() => T0);
    const challenge = issueChallenge(KEY, "signin", at(0));
    const last = BASE64URL_ALPHABET.indexOf(challenge.at(-1)!);
    const nonCanonical = challenge.slice(0, -1) + BASE64URL_ALPHABET[last | 1];
    for (const candidate of [nonCanonical, "", "not a challenge", challenge.slice(0, -2)]) {
      expect((await failure(spendChallenge(kv, candidate, at(0)))).code).toBe("passkey_invalid");
      expect(await kv.get(spentKey(candidate))).toBeNull();
    }
    await spendChallenge(kv, challenge, at(0));
  });

  test("spending one challenge leaves every other one spendable", async () => {
    const kv = new MemoryKv(() => T0);
    const a = issueChallenge(KEY, "signin", at(0));
    const b = issueChallenge(KEY, "signin", at(0));
    await spendChallenge(kv, a, at(0));
    await spendChallenge(kv, b, at(0));
    expect((await failure(spendChallenge(kv, a, at(0)))).code).toBe("passkey_invalid");
  });
});
```

### Replace `apps/api/test/cli-grant-role.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { GRANT_ROLE_USAGE, grantRoleReport, parseGrantRoleArgs } from "../src/cli/grant-role";

describe("grant-role arguments", () => {
  test("accepts an email and a role, normalising the email", () => {
    expect(parseGrantRoleArgs([" Mod@Korbat.Local ", "moderator"])).toEqual({ email: "mod@korbat.local", role: "moderator" });
    expect(parseGrantRoleArgs(["a@b.io", "user"]).role).toBe("user");
    expect(parseGrantRoleArgs(["a@b.io", "admin"]).role).toBe("admin");
  });

  test("prints usage for a wrong number of arguments", () => {
    expect(() => parseGrantRoleArgs([])).toThrow(GRANT_ROLE_USAGE);
    expect(() => parseGrantRoleArgs(["a@b.io"])).toThrow(GRANT_ROLE_USAGE);
    expect(() => parseGrantRoleArgs(["a@b.io", "admin", "extra"])).toThrow(GRANT_ROLE_USAGE);
  });

  test("rejects an unknown role", () => {
    expect(() => parseGrantRoleArgs(["a@b.io", "superuser"])).toThrow("unknown role: superuser");
    expect(() => parseGrantRoleArgs(["a@b.io", "Admin"])).toThrow("unknown role: Admin");
  });

  test("rejects something that is not an email address", () => {
    expect(() => parseGrantRoleArgs(["moderator", "a@b.io"])).toThrow("not an email address: moderator");
  });
});

describe("grant-role's report", () => {
  const granted = { userId: "u1", previousRole: "moderator" as const, staffSessionsRevoked: 2, enrollmentsDeleted: 1, staffKeysRevoked: 1, mailError: null, tombstoneError: null };

  test("the summary, and no warning when every step after the commit went through", () => {
    expect(grantRoleReport(granted, "user")).toEqual({
      out: ["user u1: role moderator -> user; every session revoked; 2 staff sessions and 1 staff keys revoked, 1 unused enrolment links deleted"],
      warnings: [],
    });
  });

  test("a mail or the tombstones that failed after the commit are warnings beside the summary: the change stands", () => {
    const report = grantRoleReport({ ...granted, mailError: "smtp down", tombstoneError: "connect ECONNREFUSED 127.0.0.1:6379" }, "user");
    expect(report.out).toEqual(grantRoleReport(granted, "user").out);
    expect(report.warnings).toHaveLength(2);
    expect(report.warnings[0]).toMatch(/revoked app sessions could not be marked .*ECONNREFUSED.*the change stands/);
    expect(report.warnings[1]).toMatch(/staff_keys_revoked mail .*smtp down.*the change stands/);
  });
});
```

### Replace `apps/api/test/integration/audit-verify.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { stepUpActionHash } from "@korbat/contracts";
import { auditHead, auditLog, closeDb, createDb, staffKeys, users, type Db, type DbTx } from "@korbat/db";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { AUDIT_VERIFY_PAGE_SIZE, auditVerify, checkAuditRecord, runStaffCommand, type AuditReport } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { CHAIN_VECTORS } from "../staff/chain-vectors";
import { flowHarness } from "./flow-harness";
import { enrolKey } from "./staff-enrolment";
import { TEST_CONSOLE, TEST_CONSOLE_ORIGIN, issueEnrolment, newStaffAccount, newStaffKey, rolledBack, withLockTimeout } from "./staff-fixtures";
import { revokeConfirmed, signedIn } from "./staff-step-up";

/**
 * audit-verify (3a design, sections 7 and 12) against the real database: the canonical text in Node against the trigger's
 * in SQL, the chain under concurrent writers, rewrites by the owner detected against kept places, and every staff key's
 * one staff_key_added row. Every test that writes a row audit-verify must refuse does it in a transaction that ends in a
 * rollback and hands that transaction to the verifier's check, so no later suite sees a broken chain.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: audit-verify", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  const actorId = "00000000-0000-0000-0000-000000000000";

  /** One ordinary row, as a writer on the API role inserts it: no id, time or chain column supplied. */
  const insertRow = (db: Db | DbTx, action = `probe-${randomUUID()}`) =>
    db.insert(auditLog).values({ actorId, action, targetType: "user", targetId: randomUUID(), metadata: { via: "test" } }).returning();

  const readHead = async (db: Db | DbTx = apiDb) => (await db.select().from(auditHead))[0]!;
  const hashAt = async (seq: number) => (await apiDb.select({ hash: auditLog.hash }).from(auditLog).where(eq(auditLog.chainSeq, seq)))[0]!.hash;

  /**
   * What the owner can do: chain every row from place `from` again with the database's own text function, as migration
   * 0012's back-fill does, and move the head, so a plain recompute of the chain passes over the changed rows.
   */
  const rechainFrom = (tx: DbTx, from: number) =>
    tx.execute(
      sql.raw(`DO $$
        DECLARE r public.audit_log; prev text;
        BEGIN
          SELECT hash INTO prev FROM public.audit_log WHERE chain_seq = ${from - 1};
          FOR r IN SELECT * FROM public.audit_log WHERE chain_seq >= ${from} ORDER BY chain_seq LOOP
            prev := encode(sha256(convert_to(prev || public.audit_chain_text(r), 'UTF8')), 'hex');
            UPDATE public.audit_log SET prev_hash = (SELECT hash FROM public.audit_log WHERE chain_seq = r.chain_seq - 1), hash = prev WHERE id = r.id;
          END LOOP;
          UPDATE public.audit_head SET hash = prev WHERE id = 1;
        END $$`),
    );

  /** The verifier's own connections, as the command line opens them: one on each role. */
  const ownConnections = () => ({ api: createDb(loadConfig().DATABASE_URL_API, { max: 1 }), auth: createDb(loadConfig().DATABASE_URL_AUTH, { max: 1 }) });

  /**
   * What the command line printed, and its exit code, for a run with the given environment changes; with `inherit` false,
   * the run sees `env` alone and nothing of the test environment.
   */
  async function cli(args: string[], env: Record<string, string> = {}, inherit = true) {
    const lines: string[] = [];
    const code = await runStaffCommand(args, inherit ? { ...process.env, ...env } : env, { log: (line) => lines.push(line), error: (line) => lines.push(line) });
    return { code, text: lines.join("\n") };
  }

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    // A few committed rows, so the log is never empty whatever order the suites run in.
    for (let i = 0; i < 3; i++) await withLockTimeout(apiDb, (tx) => insertRow(tx));
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  test("a whole chain passes, with the head, and every kept place it is given", async () => {
    const head = await readHead();
    const connections = ownConnections();
    try {
      const plain = await auditVerify(connections, []);
      expect(plain).toMatchObject({ ok: true, rows: head.seq, head: { seq: head.seq, hash: head.hash }, keptChecked: 0, unanchored: head.seq, problems: [], problemCount: 0 });
      const kept = await auditVerify(connections, [
        { seq: 1, hash: await hashAt(1) },
        { seq: head.seq - 1, hash: await hashAt(head.seq - 1) },
      ]);
      expect(kept).toMatchObject({ ok: true, keptChecked: 2, unanchored: 1, problems: [] });
    } finally {
      await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
    }
  });

  describe("parity: the canonical text in Node and in SQL", () => {
    test("the vectors' rows, written through the trigger from a session in another time zone and date style, recompute to their stored hashes", async () => {
      // One connection, so the session's settings hold for the transaction below.
      const odd = createDb(loadConfig().DATABASE_URL_API, { max: 1 });
      try {
        await odd.execute(sql`set timezone = 'Asia/Kathmandu'`);
        await odd.execute(sql`set datestyle = 'SQL, DMY'`);
        // Rolled back: the step-up row carries an assertion no stored key made, which audit-verify's step-up checks refuse.
        await rolledBack(odd, async (tx) => {
          const [settings] = await tx.execute<{ tz: string; ds: string }>(sql`select current_setting('TimeZone') as tz, current_setting('DateStyle') as ds`);
          expect(settings).toEqual({ tz: "Asia/Kathmandu", ds: "SQL, DMY" });
          const before = await readHead(tx);
          const written: number[] = [];
          for (const vector of CHAIN_VECTORS) {
            const [row] = await tx.insert(auditLog).values(vector.insert).returning({ id: auditLog.id });
            written.push(row!.id);
          }
          // The stored jsonb prints as the vectors say, so the unit vectors hold chain.ts to what the database embeds.
          const texts = await tx
            .select({ id: auditLog.id, metadata: sql<string>`${auditLog.metadata}::text`, stepUp: sql<string | null>`${auditLog.stepUp}::text` })
            .from(auditLog)
            .where(inArray(auditLog.id, written))
            .orderBy(auditLog.chainSeq);
          expect(texts.map((t) => [t.metadata, t.stepUp])).toEqual(CHAIN_VECTORS.map((v) => [v.metadataText, v.stepUpText]));

          // The API role cannot read the staff keys: they come from the auth role's pool, as the command line reads them.
          // Every hash recomputes; the one problem is the step-up vector's, whose assertion no stored key made, and which
          // is the last vector.
          const report = await checkAuditRecord(tx, [], authDb);
          expect(CHAIN_VECTORS.at(-1)!.insert.stepUp).not.toBeNull();
          expect(CHAIN_VECTORS.filter((vector) => vector.insert.stepUp !== null)).toHaveLength(1);
          expect(report.problems).toEqual([{ place: before.seq + CHAIN_VECTORS.length, message: expect.stringMatching(/^its step-up/) }]);
          expect(report.rows).toBe(before.seq + CHAIN_VECTORS.length);
        });
      } finally {
        await closeDb(odd);
      }
    });
  });

  describe("concurrency", () => {
    test("several sessions insert at once, some inside transactions, while keys are enrolled: every run passes, during and after", async () => {
      const WRITERS = 6;
      const EACH = 10;
      const config = loadConfig();
      // One connection per writer, each with a lock timeout for the whole session.
      const writers = Array.from({ length: WRITERS }, () => createDb(config.DATABASE_URL_API, { max: 1 }));
      const connections = ownConnections();
      const reports: AuditReport[] = [];
      let writing = true;
      try {
        await Promise.all(writers.map((db) => db.execute(sql`set lock_timeout = '10s'`)));
        const verifying = (async () => {
          while (writing) reports.push(await auditVerify(connections, []));
        })();
        await Promise.all([
          ...writers.map(async (db, w) => {
            for (let i = 0; i < EACH; i++) {
              const action = `concurrent-verify-${w}-${i}`;
              if (i % 2 === 0) {
                await insertRow(db, action);
              } else {
                // A transaction that waits a moment before its insert, which is its last statement, as every audit write's.
                await db.transaction(async (tx) => {
                  await tx.execute(sql`select pg_sleep(${Math.random() * 0.01})`);
                  await insertRow(tx, action);
                });
              }
            }
          }),
          // Keys enrolled meanwhile: a key whose staff_key_added row lies beyond the head a run read is left to the next run.
          (async () => {
            for (let i = 0; i < 3; i++) await newStaffKey(authDb, migrateDb, repo);
          })(),
        ]);
        writing = false;
        await verifying;
        const final = await auditVerify(connections, []);
        const head = await readHead();

        expect(reports.length).toBeGreaterThan(0);
        for (const report of reports) expect(report.problems).toEqual([]);
        expect(final).toMatchObject({ ok: true, rows: head.seq, head: { seq: head.seq, hash: head.hash }, keysLeftToNextRun: 0, problems: [] });
        expect(final.keysChecked).toBe(await migrateDb.$count(staffKeys));
      } finally {
        writing = false;
        await Promise.all([...writers.map((db) => closeDb(db)), closeDb(connections.api), closeDb(connections.auth)]);
      }
    });
  });

  describe("rewrites by the owner", () => {
    test("a row changed alone fails a plain run, naming its place", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const [row] = await insertRow(tx, "rewrite-alone");
        await insertRow(tx, "rewrite-alone-after");
        await tx.update(auditLog).set({ metadata: { via: "edited" } }).where(eq(auditLog.id, row!.id));
        const report = await checkAuditRecord(tx, []);
        expect(report.ok).toBe(false);
        expect(report.problems).toEqual([{ place: row!.chainSeq, message: "its hash does not match its content" }]);
      });
      // Nothing of it outlives the rollback.
      const connections = ownConnections();
      try {
        expect((await auditVerify(connections, [])).ok).toBe(true);
      } finally {
        await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
      }
    });

    test("a row changed with every later hash and the head recomputed passes a plain run, and fails against a place kept before the change", async () => {
      const head = await readHead();
      const target = head.seq - 1;
      const keptBefore = { seq: target - 1, hash: await hashAt(target - 1) };
      const keptAfter = { seq: head.seq, hash: head.hash };
      await rolledBack(migrateDb, async (tx) => {
        await tx.update(auditLog).set({ action: "rewritten" }).where(eq(auditLog.chainSeq, target));
        await rechainFrom(tx, target);
        expect((await readHead(tx)).hash).not.toBe(head.hash);

        const plain = await checkAuditRecord(tx, []);
        expect(plain.problems).toEqual([]);
        // A place kept before the changed row still holds; the one kept at or after it no longer does.
        expect((await checkAuditRecord(tx, [keptBefore])).problems).toEqual([]);
        const anchored = await checkAuditRecord(tx, [keptBefore, keptAfter]);
        expect(anchored.ok).toBe(false);
        expect(anchored.problems).toEqual([{ place: head.seq, message: expect.stringMatching(new RegExp(`^the kept place ${head.seq}:${head.hash} no longer matches`)) }]);
      });
    });
  });

  describe("rewrites by the owner that each check of the chain catches", () => {
    /** Three new rows, as a writer inserts them, in the transaction `tx`; the newest is the head. */
    const threeRows = async (tx: DbTx) => {
      const first = (await insertRow(tx, "probe-a"))[0]!;
      const middle = (await insertRow(tx, "probe-b"))[0]!;
      const last = (await insertRow(tx, "probe-c"))[0]!;
      return [first, middle, last] as const;
    };

    test("a row changed with only its own hash recomputed breaks its link to the next row, which a later kept place does not see", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const [, middle, last] = await threeRows(tx);
        await tx.update(auditLog).set({ metadata: { via: "edited" } }).where(eq(auditLog.id, middle.id));
        // The owner recomputes the changed row's own hash over its stored prev_hash, with the database's own text.
        await tx.execute(sql`update public.audit_log a set hash = encode(sha256(convert_to(a.prev_hash || public.audit_chain_text(a), 'UTF8')), 'hex') where a.id = ${middle.id}`);
        const link = { place: last.chainSeq, message: `its prev_hash is not the hash of place ${middle.chainSeq}` };
        expect((await checkAuditRecord(tx, [])).problems).toEqual([link]);
        // The place kept after it still holds its hash: only the link check catches the change.
        expect((await checkAuditRecord(tx, [{ seq: last.chainSeq, hash: last.hash }])).problems).toEqual([link]);
      });
    });

    test("a row deleted from the middle leaves its place missing and the next row's link broken", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const [first, middle, last] = await threeRows(tx);
        await tx.delete(auditLog).where(eq(auditLog.id, middle.id));
        expect((await checkAuditRecord(tx, [])).problems).toEqual([
          { place: middle.chainSeq, message: `place ${middle.chainSeq} is missing` },
          { place: last.chainSeq, message: `its prev_hash is not the hash of place ${first.chainSeq}` },
        ]);
      });
    });

    test("the newest rows deleted and the head moved back pass a plain run, and fail against a place kept before", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const [first, , last] = await threeRows(tx);
        const kept = { seq: last.chainSeq, hash: last.hash };
        await tx.delete(auditLog).where(gt(auditLog.chainSeq, first.chainSeq));
        await tx.update(auditHead).set({ seq: first.chainSeq, hash: first.hash }).where(eq(auditHead.id, 1));
        expect((await checkAuditRecord(tx, [])).problems).toEqual([]);
        expect((await checkAuditRecord(tx, [kept])).problems).toEqual([{ place: kept.seq, message: `the kept place ${kept.seq}:${kept.hash} no longer matches: no row is at that place` }]);
      });
    });

    test("the head: missing, behind the newest row, beyond it, or with another hash", async () => {
      await rolledBack(migrateDb, async (tx) => {
        await threeRows(tx);
        await tx.delete(auditHead);
        expect((await checkAuditRecord(tx, [])).problems).toEqual([{ place: null, message: "the audit head is missing" }]);
      });
      await rolledBack(migrateDb, async (tx) => {
        const [first, middle] = await threeRows(tx);
        await tx.update(auditHead).set({ seq: first.chainSeq, hash: first.hash }).where(eq(auditHead.id, 1));
        expect((await checkAuditRecord(tx, [])).problems).toEqual([{ place: middle.chainSeq, message: `rows lie beyond the head's place ${first.chainSeq}, from place ${middle.chainSeq}` }]);
      });
      await rolledBack(migrateDb, async (tx) => {
        const [, , last] = await threeRows(tx);
        await tx.update(auditHead).set({ seq: last.chainSeq + 5 }).where(eq(auditHead.id, 1));
        expect((await checkAuditRecord(tx, [])).problems).toEqual([{ place: null, message: `the head names place ${last.chainSeq + 5}, but the newest row up to it is at place ${last.chainSeq}` }]);
      });
      await rolledBack(migrateDb, async (tx) => {
        const [, , last] = await threeRows(tx);
        await tx.update(auditHead).set({ hash: "e".repeat(64) }).where(eq(auditHead.id, 1));
        expect((await checkAuditRecord(tx, [])).problems).toEqual([{ place: last.chainSeq, message: "the head's hash is not the hash of the row at its place" }]);
      });
    });

    test("a row moved to place 0, or beyond the head, is named", async () => {
      await rolledBack(migrateDb, async (tx) => {
        const [, middle] = await threeRows(tx);
        await tx.update(auditLog).set({ chainSeq: 0 }).where(eq(auditLog.id, middle.id));
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toContainEqual({ place: 0, message: "its place is not in the chain, which runs from place 1" });
        expect(report.problems).toContainEqual({ place: middle.chainSeq, message: `place ${middle.chainSeq} is missing` });
      });
      await rolledBack(migrateDb, async (tx) => {
        const [, middle, last] = await threeRows(tx);
        await tx.update(auditLog).set({ chainSeq: last.chainSeq + 10 }).where(eq(auditLog.id, middle.id));
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toContainEqual({ place: last.chainSeq + 10, message: `rows lie beyond the head's place ${last.chainSeq}, from place ${last.chainSeq + 10}` });
        expect(report.problems).toContainEqual({ place: middle.chainSeq, message: `place ${middle.chainSeq} is missing` });
      });
    });

    /**
     * What the owner can do to plant a row the walk by place never reaches: turn the trigger off and drop the unique index
     * on chain_seq (or its NOT NULL), then insert. The planted row is a step-up action's with no confirmation, which a walk
     * that read it would refuse; it repeats the genuine row's prev_hash and hash, so no other row or the head changes.
     */
    const plant = (tx: DbTx, place: number | null, copy: { prevHash: string; hash: string }) =>
      tx.execute(sql`insert into public.audit_log (actor_id, action, target_type, target_id, metadata, chain_version, chain_seq, prev_hash, hash)
        values (${actorId}::uuid, 'staff_session_revoked', 'staff_session', ${randomUUID()}, '{"params": {}}'::jsonb, 1, ${place}::bigint, ${copy.prevHash}, ${copy.hash})`);

    test("a second row at a place that ends a page of the walk is read and refused", { timeout: 60_000 }, async () => {
      await rolledBack(migrateDb, async (tx) => {
        // Enough rows that a page of the walk ends at a place, with rows after it.
        const page = AUDIT_VERIFY_PAGE_SIZE;
        const short = page + 5 - (await readHead(tx)).seq;
        if (short > 0) {
          await tx.execute(sql`insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
            select ${actorId}::uuid, 'probe-page', 'user', gen_random_uuid()::text, '{"via": "test"}'::jsonb from generate_series(1, ${short})`);
        }
        const [genuine] = await tx.select().from(auditLog).where(eq(auditLog.chainSeq, page));
        await tx.execute(sql`alter table public.audit_log disable trigger audit_chain`);
        await tx.execute(sql`drop index public.audit_log_chain_seq_idx`);
        // A plain index in its place, as the owner might leave it: equal places come back oldest row first, so a walk by
        // place alone reads the genuine row and never the second.
        await tx.execute(sql`create index audit_log_chain_seq_plain on public.audit_log (chain_seq)`);
        await plant(tx, page, genuine!);
        const report = await checkAuditRecord(tx, []);
        expect(report.ok).toBe(false);
        expect(report.problems).toContainEqual({ place: page, message: "another row is already at this place" });
        expect(report.problems).toContainEqual({ place: page, message: "its action, staff_session_revoked, needs a step-up, and it carries none" });
        expect(report.problems).toContainEqual({ place: null, message: "1 row is at a place another row already holds" });
      });
    });

    test("a row with no place at all is counted and refused", { timeout: 30_000 }, async () => {
      await rolledBack(migrateDb, async (tx) => {
        const head = await readHead(tx);
        const [newest] = await tx.select().from(auditLog).where(eq(auditLog.chainSeq, head.seq));
        await tx.execute(sql`alter table public.audit_log disable trigger audit_chain`);
        await tx.execute(sql`alter table public.audit_log alter column chain_seq drop not null`);
        await plant(tx, null, newest!);
        const total = (await tx.select({ n: sql<string>`count(*)::text` }).from(auditLog))[0]!.n;
        const report = await checkAuditRecord(tx, []);
        expect(report.ok).toBe(false);
        expect(report.problems).toEqual([
          { place: null, message: "1 row of the audit log has no place in the chain" },
          { place: null, message: `the audit log holds ${total} rows, but ${head.seq} were read up to the head and 0 lie beyond it` },
        ]);
      });
    });
  });

  describe("step-up confirmations", () => {
    const harness = () => flowHarness(repo, { console: TEST_CONSOLE });

    /**
     * A staff account with a key enrolled through the flow and three sessions; from the first it revokes the other two,
     * each confirmed with the key through the step-up flow: two genuine step-up rows, committed, as only the flow writes them.
     */
    async function confirmedRevocations() {
      const h = harness();
      const { user } = await newStaffAccount(authDb, repo);
      const soft = new SoftAuthenticator();
      const enrolled = await enrolKey(h, soft, (await issueEnrolment(migrateDb, user.id)).token);
      const [a, b, c] = [await signedIn(h, soft, enrolled.credentialId, 1), await signedIn(h, soft, enrolled.credentialId, 2), await signedIn(h, soft, enrolled.credentialId, 3)];
      expect((await revokeConfirmed(h, soft, enrolled.credentialId, a.session, b.session.handle, 4)).revoked).toBe(true);
      expect((await revokeConfirmed(h, soft, enrolled.credentialId, a.session, c.session.handle, 5)).revoked).toBe(true);
      const rowOf = async (handle: string) => (await apiDb.select().from(auditLog).where(and(eq(auditLog.action, "staff_session_revoked"), eq(auditLog.targetId, handle))))[0]!;
      return { user, keyId: enrolled.key.id, a: a.session, b: b.session, c: c.session, first: await rowOf(b.session.handle), second: await rowOf(c.session.handle) };
    }

    /** The problems a check found, as place and message, each expected to name the step-up check. */
    const stepUpProblems = (report: AuditReport) => report.problems.map((p) => ({ place: p.place, stepUp: /step-up/.test(p.message) }));

    test("genuine confirmations pass: on the command line's own connections, with the console off, and with nothing but the database URLs", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      expect(s.first).toMatchObject({ staffSession: s.a.handle, keyId: s.keyId, actorId: s.user.id });
      expect(s.first.stepUp).not.toBeNull();
      const connections = ownConnections();
      try {
        const report = await auditVerify(connections, []);
        expect(report.problems).toEqual([]);
        expect(report.ok).toBe(true);
      } finally {
        await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
      }
      const off = await cli(["audit-verify"], { CONSOLE_ORIGIN: "", CONSOLE_RP_ID: "" });
      expect(off.code, off.text).toBe(0);
      const bare = await cli(["audit-verify"], { DATABASE_URL_API: process.env.DATABASE_URL_API!, DATABASE_URL_AUTH: process.env.DATABASE_URL_AUTH! }, false);
      expect(bare.code, bare.text).toBe(0);
    });

    test("a confirmed row changed by the owner with the chain and the head recomputed fails on its step-up alone: its params, its target, its session, its hash with its params, or its time past the challenge's expiry", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      const otherParams = { params: { all: true } };
      const changes: [string, Record<string, unknown>, RegExp][] = [
        ["its params", { metadata: otherParams }, /^its step-up's action hash is not the hash of its action, target and params$/],
        ["its target", { targetId: s.c.handle }, /^its step-up's action hash is not the hash of its action, target and params$/],
        ["its session", { staffSession: s.b.handle }, /^its step-up's challenge was not issued for this action in this session$/],
        [
          "its params and its action hash together",
          { metadata: otherParams, actionHash: await stepUpActionHash({ action: "staff_session_revoked", target: { type: "staff_session", id: s.b.handle }, params: otherParams.params }) },
          /^its step-up's challenge was not issued for this action in this session$/,
        ],
        ["its time, past the challenge's expiry", { createdAt: new Date(s.first.createdAt.getTime() + 11 * 60_000) }, /^its step-up's challenge had expired when the row was written$/],
      ];
      for (const [label, change, message] of changes) {
        await rolledBack(migrateDb, async (tx) => {
          await tx.update(auditLog).set(change).where(eq(auditLog.id, s.first.id));
          await rechainFrom(tx, s.first.chainSeq);
          const report = await checkAuditRecord(tx, []);
          expect(report.problems, label).toEqual([{ place: s.first.chainSeq, message: expect.stringMatching(message) }]);
        });
      }
      // Nothing of it outlives the rollbacks.
      const connections = ownConnections();
      try {
        expect((await auditVerify(connections, [])).problems).toEqual([]);
      } finally {
        await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
      }
    });

    test("an assertion moved to another row fails there, on its binding and as a challenge used twice", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      await rolledBack(migrateDb, async (tx) => {
        // The first row's assertion, signed by the same key in the same session, on the second row: only the binding of
        // its target, and the challenge's second use, give it away.
        await tx.update(auditLog).set({ stepUp: s.first.stepUp }).where(eq(auditLog.id, s.second.id));
        await rechainFrom(tx, s.second.chainSeq);
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual([
          { place: s.second.chainSeq, message: "its step-up's challenge was not issued for this action in this session" },
          { place: s.second.chainSeq, message: `its step-up's challenge was already used at place ${s.first.chainSeq}` },
        ]);
      });
    });

    test("a row of a step-up action without a confirmation fails, whatever its actor: a staff account, a demoted one, the system", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      const { user: demoted } = await newStaffAccount(authDb, repo);
      await authDb.update(users).set({ role: "user" }).where(eq(users.id, demoted.id));
      await rolledBack(migrateDb, async (tx) => {
        const places: number[] = [];
        for (const actor of [s.user.id, demoted.id, actorId]) {
          const [row] = await tx
            .insert(auditLog)
            .values({ actorId: actor, action: "staff_session_revoked", targetType: "staff_session", targetId: randomUUID(), staffSession: randomUUID(), metadata: { params: {} } })
            .returning({ chainSeq: auditLog.chainSeq });
          places.push(row!.chainSeq);
        }
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual(places.map((place) => ({ place, message: "its action, staff_session_revoked, needs a step-up, and it carries none" })));
      });
    });

    test("a confirmation whose key belongs to another account than the row's actor fails, as one whose key records another origin or relying party ID", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      const { user: other } = await newStaffAccount(authDb, repo);
      await rolledBack(migrateDb, async (tx) => {
        await tx.update(auditLog).set({ actorId: other.id }).where(eq(auditLog.id, s.first.id));
        await rechainFrom(tx, s.first.chainSeq);
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual([{ place: s.first.chainSeq, message: `its step-up's key ${s.keyId} belongs to another account than its actor` }]);
      });
      // The key's recorded origin and relying party ID, which the owner can change too: the confirmation was made for
      // the ones the key was enrolled with, never checked against the console's configuration.
      for (const [label, change, message] of [
        ["origin", { origin: "http://console.example:8090" }, "its step-up's client data is not a webauthn.get from the origin recorded on its key"],
        ["relying party ID", { rpId: "console.example" }, "its step-up's authenticator data does not name the relying party ID recorded on its key"],
      ] as const) {
        await rolledBack(migrateDb, async (tx) => {
          await tx.update(staffKeys).set(change).where(eq(staffKeys.id, s.keyId));
          const report = await checkAuditRecord(tx, []);
          expect(report.problems, label).toEqual([
            { place: s.first.chainSeq, message },
            { place: s.second.chainSeq, message },
          ]);
        });
      }
    });

    test("a signature that does not verify with the key's public key fails", { timeout: 60_000 }, async () => {
      const s = await confirmedRevocations();
      await rolledBack(migrateDb, async (tx) => {
        const stepUp = s.first.stepUp as { authenticatorData: string; clientDataJSON: string; signature: string };
        const signature = Buffer.from(stepUp.signature, "base64url");
        signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
        await tx.update(auditLog).set({ stepUp: { ...stepUp, signature: signature.toString("base64url") } }).where(eq(auditLog.id, s.first.id));
        await rechainFrom(tx, s.first.chainSeq);
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual([{ place: s.first.chainSeq, message: `its step-up's signature does not verify with the public key of key ${s.keyId}` }]);
      });
    });
  });

  describe("staff keys", () => {
    test("a key without its staff_key_added row fails, naming the key", async () => {
      const { user } = await newStaffAccount(authDb, repo);
      await rolledBack(migrateDb, async (tx) => {
        // Only the owner can plant one: the auth role cannot insert a key, and add_staff_key writes the row with it.
        const [key] = await tx
          .insert(staffKeys)
          .values({ userId: user.id, credentialId: randomUUID(), publicKey: "cose-key", name: "planted", origin: TEST_CONSOLE_ORIGIN, rpId: "console.localhost" })
          .returning({ id: staffKeys.id });
        const report = await checkAuditRecord(tx, []);
        expect(report.problems).toEqual([{ place: null, message: `staff key ${key!.id} has no staff_key_added row` }]);
      });
    });

    test("a key enrolled after the head a run read, before it read the keys, is left to the next run, which checks it", { timeout: 30_000 }, async () => {
      const connections = ownConnections();
      try {
        // The keys are read on the auth role right after the head; a key enrolled between the two has its staff_key_added
        // row beyond the head this run read, so the run leaves it to the next instead of calling it a problem.
        let enrolled: string | undefined;
        const between = {
          select: (fields: Parameters<Db["select"]>[0]) => ({
            from: (table: typeof staffKeys) => ({
              then: (resolve: (rows: unknown) => unknown, reject: (err: unknown) => unknown) =>
                newStaffKey(authDb, migrateDb, repo)
                  .then((added) => {
                    enrolled = added.key.id;
                    return connections.auth.select(fields!).from(table);
                  })
                  .then(resolve, reject),
            }),
          }),
        } as unknown as Db;
        const report = await auditVerify({ api: connections.api, auth: between }, []);
        expect(enrolled).toBeDefined();
        expect(report).toMatchObject({ ok: true, keysLeftToNextRun: 1, problems: [] });
        // The next run reads a head beyond the key's row, and checks the key.
        const next = await auditVerify(connections, []);
        expect(next).toMatchObject({ ok: true, keysLeftToNextRun: 0, problems: [] });
        expect(next.keysChecked).toBe(report.keysChecked);
      } finally {
        await Promise.all([closeDb(connections.api), closeDb(connections.auth)]);
      }
    });

    test("a key with a second staff_key_added row fails, naming both places", async () => {
      const { key } = await newStaffKey(authDb, migrateDb, repo);
      const [first] = await apiDb.select({ seq: auditLog.chainSeq }).from(auditLog).where(eq(auditLog.keyId, key.id));
      // The API role can insert any action; a second row claiming the key's addition is refused by audit-verify.
      await rolledBack(apiDb, async (tx) => {
        const [second] = await tx.insert(auditLog).values({ actorId, action: "staff_key_added", targetType: "staff_key", targetId: key.id, keyId: key.id }).returning();
        const report = await checkAuditRecord(tx, [], authDb);
        expect(report.problems).toEqual([{ place: null, message: `staff key ${key.id} has 2 staff_key_added rows (places ${first!.seq}, ${second!.chainSeq})` }]);
      });
    });
  });

  describe("the command line", () => {
    test("audit-verify passes the same with the console off and on, and needs nothing of the console's configuration", async () => {
      const head = await readHead();
      const envs: Record<string, string>[] = [{ CONSOLE_ORIGIN: "" }, { CONSOLE_ORIGIN: "", CONSOLE_RP_ID: "" }, { CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN }];
      for (const env of envs) {
        const run = await cli(["audit-verify", `${head.seq}:${head.hash}`], env);
        expect(run.code, JSON.stringify(env)).toBe(0);
        expect(run.text).toContain(`the chain holds: ${head.seq} rows, from place 1 to the head ${head.seq}:${head.hash}`);
        expect(run.text).toContain("1 kept place checked; 0 rows after the newest kept place are not yet anchored");
      }
    });

    test("audit-verify and audit-head run given the database URLs alone: no secret, no other setting, and a console setting the API refuses changes nothing", async () => {
      const head = await readHead();
      const urls = { DATABASE_URL_API: process.env.DATABASE_URL_API!, DATABASE_URL_AUTH: process.env.DATABASE_URL_AUTH! };
      const envs: Record<string, string>[] = [
        urls,
        // A final slash, which the API's configuration refuses in CONSOLE_ORIGIN.
        { ...urls, CONSOLE_ORIGIN: "https://console.example/" },
        // The console on the app's origin, which it refuses too.
        { ...urls, APP_ORIGIN: process.env.APP_ORIGIN!, CONSOLE_ORIGIN: process.env.APP_ORIGIN! },
      ];
      for (const env of envs) {
        const run = await cli(["audit-verify", `${head.seq}:${head.hash}`], env, false);
        expect(run.code, JSON.stringify(Object.keys(env))).toBe(0);
        expect(run.text).toContain(`the chain holds: ${head.seq} rows, from place 1 to the head ${head.seq}:${head.hash}`);
      }
      const headRun = await cli(["audit-head"], { DATABASE_URL_API: urls.DATABASE_URL_API }, false);
      expect(headRun.code).toBe(0);
      expect(headRun.text).toMatch(new RegExp(`^${head.seq}:${head.hash} `));
    });

    test("audit-verify exits 1 and names the place at fault when a kept place does not match", async () => {
      const head = await readHead();
      const run = await cli(["audit-verify", `1:${await hashAt(1)}`, `${head.seq}:${"f".repeat(64)}`]);
      expect(run.code).toBe(1);
      expect(run.text).toContain("audit-verify: FAILED");
      expect(run.text).toContain(`place ${head.seq}: the kept place ${head.seq}:${"f".repeat(64)} no longer matches`);
    });

    test("audit-head prints the newest place, its hash and its time, and they are what audit_head holds", async () => {
      const head = await readHead();
      const [newest] = await apiDb.select().from(auditLog).where(eq(auditLog.chainSeq, head.seq));
      const run = await cli(["audit-head"], { CONSOLE_ORIGIN: "" });
      expect(run.code).toBe(0);
      expect(run.text).toBe(`${head.seq}:${head.hash} ${newest!.createdAt.toISOString()}`);
    });
  });
});
```

### Replace `apps/api/test/integration/auth-flows-account.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authEvents, closeDb, createDb, type Db } from "@korbat/db";
import { grantRole } from "../../src/auth/admin";
import { encrypt, randomToken } from "../../src/auth/crypto";
import { listSessions, me, revokeAllSessions, revokeSession, signOut } from "../../src/auth/flows/account";
import { startEmail } from "../../src/auth/flows/email";
import { notMe } from "../../src/auth/flows/not-me";
import { reauthenticate, startReauthEmail } from "../../src/auth/flows/reauth";
import { notMeKey, type NotMeToken } from "../../src/auth/flows/signin";
import { emailHash } from "../../src/auth/identifiers";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { hashRecoveryCode, newRecoveryCodes } from "../../src/auth/recovery-codes";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { REAUTH_WINDOW_MS, type Session } from "../../src/auth/sessions";
import { newTotpSecret } from "../../src/auth/totp";
import { loadConfig } from "../../src/config";
import { currentTotpCode, flowHarness, newTestDevice, newTestEmail, onboardedUser, wrongCode, type FlowHarness } from "./flow-harness";

const PASSWORD = "correct horse battery staple";
const LINK_GONE = "This link has expired or was already used.";

describe.skipIf(!process.env.INTEGRATION)("integration: re-authentication, account and session flows", () => {
  let db: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    repo = createAuthRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  /** Turns TOTP on for an account as the confirm step leaves it, with recovery codes, and answers the codes in the clear. */
  async function enableTotp(h: FlowHarness, userId: string): Promise<string[]> {
    const codes = newRecoveryCodes();
    await repo.enableTotp(userId, {
      secretEnc: encrypt(Buffer.from(newTotpSecret()), h.deps.config.totpKey),
      recoveryCodesHash: codes.map((code) => hashRecoveryCode(h.deps.config.authHmacKey, code)),
      now: h.clock.now(),
    });
    await h.deps.sessions.forgetUser(userId);
    return codes;
  }

  /** The account's events oldest first, with the metadata the flows wrote. */
  const eventsOf = (userId: string) =>
    db
      .select({ type: authEvents.type, deviceId: authEvents.deviceId, ipHash: authEvents.ipHash, metadata: authEvents.metadata })
      .from(authEvents)
      .where(eq(authEvents.userId, userId))
      .orderBy(authEvents.id);

  test("re-authenticating with the password or a TOTP code writes the factor, rotates the token and answers the level reached; wrong credentials do not", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await enableTotp(h, account.user.id);
    let token = account.token;
    const current = async () => (await h.deps.sessions.resolve(token))!.session;
    const stale = async () => {
      h.clock.advance(REAUTH_WINDOW_MS + 1_000);
      const session = await current();
      expect(h.deps.sessions.isFresh(session)).toBe(false);
      return session;
    };

    let session = await stale();
    await expect(reauthenticate(h.deps, session, { method: "password", password: "wrong password entirely" }, h.ctx)).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(h.deps.sessions.isFresh(await current())).toBe(false);
    const byPassword = await reauthenticate(h.deps, session, { method: "password", password: PASSWORD }, h.ctx);
    expect(byPassword).toMatchObject({ level: 1, mustReenrollMfa: false });
    // The factor is written with the flows' clock, the reauth time follows it, and the token rotates in place: same handle, same device.
    expect(byPassword.issued.session).toMatchObject({ handle: session.handle, deviceId: session.deviceId, factors: { ...session.factors, password: h.clock.ms() }, reauthAt: h.clock.now() });
    expect(await h.deps.sessions.resolve(token)).toBeNull();
    token = byPassword.issued.token;
    expect(h.deps.sessions.isFresh(await current())).toBe(true);

    session = await current();
    const code = await currentTotpCode(h, repo, account.user.id);
    await expect(reauthenticate(h.deps, session, { method: "totp", code: wrongCode(code) }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });
    const byTotp = await reauthenticate(h.deps, session, { method: "totp", code }, h.ctx);
    // With the password still in the window, the code makes level 2.
    expect(byTotp).toMatchObject({ level: 2, mustReenrollMfa: false });
    expect(byTotp.issued.session.factors).toEqual({ ...session.factors, totp: h.clock.ms() });
    expect(await h.deps.sessions.resolve(token)).toBeNull();
    token = byTotp.issued.token;

    // Five minutes later a code alone is level 1 again: the first factor must be as recent as the second.
    session = await stale();
    const alone = await reauthenticate(h.deps, session, { method: "totp", code: await currentTotpCode(h, repo, account.user.id) }, h.ctx);
    expect(alone.level).toBe(1);
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(alone.issued.token))!.session)).toBe(1);
  });

  test("re-authenticating by email accepts only a re-auth code for this account, once, and sends three codes an hour per session", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const other = await onboardedUser(h, repo);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const session = (await h.deps.sessions.resolve(account.token))!.session;

    const { flowId } = await startReauthEmail(h.deps, session, h.ctx);
    const reauthMail = h.mailer.sent.at(-1)!;
    expect(reauthMail).toMatchObject({ to: account.email, template: "reauth_code" });
    const reauthCode = reauthMail.data.code!;

    const otherSession = (await h.deps.sessions.resolve(other.token))!.session;
    const otherFlow = await startReauthEmail(h.deps, otherSession, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: otherFlow.flowId, code: h.mailer.lastCodeFor(other.email)! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_code",
    });

    const signInFlow = await startEmail(h.deps, { email: account.email, turnstileToken: "ok", ...newTestDevice() }, h.ctx);
    await expect(reauthenticate(h.deps, session, { method: "email", flowId: signInFlow.flowId, code: h.mailer.lastCodeFor(account.email)! }, h.ctx)).rejects.toMatchObject({
      code: "invalid_code",
    });

    const byEmail = await reauthenticate(h.deps, session, { method: "email", flowId, code: reauthCode }, h.ctx);
    expect(byEmail).toMatchObject({ level: 1, mustReenrollMfa: false });
    expect(byEmail.issued.session).toMatchObject({ handle: session.handle, factors: { email: h.clock.ms() } });
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(h.deps.sessions.isFresh((await h.deps.sessions.resolve(byEmail.issued.token))!.session)).toBe(true);
    await expect(reauthenticate(h.deps, byEmail.issued.session, { method: "email", flowId, code: reauthCode }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });

    // Three codes an hour, counted by the session's handle, which the rotation kept; another session of the account has three of its own.
    for (let i = 0; i < 2; i++) await startReauthEmail(h.deps, byEmail.issued.session, h.ctx);
    await expect(startReauthEmail(h.deps, byEmail.issued.session, h.ctx)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: HOUR / 1000 });
    const second = await h.deps.sessions.issue(account.user.id, session.deviceId, { factors: { email: h.clock.ms() } });
    expect((await startReauthEmail(h.deps, second.session, h.ctx)).flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("re-authentication allows five tries per session every 15 minutes, counted by the handle so two sessions of one account share nothing and a rotation resets nothing", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const wrong = (session: Session) => reauthenticate(h.deps, session, { method: "email", flowId: randomToken(), code: "000000" }, h.ctx);
    for (let i = 0; i < 5; i++) await expect(wrong(account.session)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(reauthenticate(h.deps, account.session, { method: "password", password: PASSWORD }, h.ctx)).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: (15 * MINUTE) / 1000 });

    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const ok = await reauthenticate(h.deps, second.session, { method: "password", password: PASSWORD }, h.ctx);
    expect(ok.level).toBe(1);
    // The success counted as one of the five, and the rotated session carries the count on: four more tries, then the limit.
    for (let i = 0; i < 4; i++) await expect(wrong(ok.issued.session)).rejects.toMatchObject({ code: "invalid_code" });
    await expect(wrong(ok.issued.session)).rejects.toMatchObject({ code: "rate_limited" });
  });

  test("re-authentication allows thirty tries per address every 15 minutes, whichever sessions try", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    const ctx = { ...h.ctx, ipHash: randomToken() };
    const newSession = async () => (await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } })).session;
    const wrong = (session: Session) => reauthenticate(h.deps, session, { method: "email", flowId: randomToken(), code: "000000" }, ctx);
    // Six sessions, five tries each: none reaches its own limit, together they reach the address's.
    for (let s = 0; s < 6; s++) {
      const session = await newSession();
      for (let i = 0; i < 5; i++) await expect(wrong(session)).rejects.toMatchObject({ code: "invalid_code" });
    }
    await expect(wrong(await newSession())).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: (15 * MINUTE) / 1000 });
    // Another address is not affected.
    await expect(reauthenticate(h.deps, await newSession(), { method: "email", flowId: randomToken(), code: "000000" }, h.ctx)).rejects.toMatchObject({ code: "invalid_code" });
  });

  test("a recovery code re-authenticates an account with TOTP once, makes level 2 after a password, and is recorded and announced", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const without = await onboardedUser(h, repo, { password: PASSWORD });
    await expect(reauthenticate(h.deps, without.session, { method: "recovery", recoveryCode: "abcd-ef23-gh45" }, h.ctx)).rejects.toMatchObject({ code: "mfa_required", status: 400 });

    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const codes = await enableTotp(h, account.user.id);
    h.clock.advance(REAUTH_WINDOW_MS + 1_000);
    const session = (await h.deps.sessions.resolve(account.token))!.session;
    // A wrong code is refused, recorded as a failed sign-in by recovery code, and rotates nothing.
    await expect(reauthenticate(h.deps, session, { method: "recovery", recoveryCode: "abcd-ef23-gh45" }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code", status: 401 });
    expect(await h.deps.sessions.resolve(account.token)).not.toBeNull();

    const byPassword = await reauthenticate(h.deps, session, { method: "password", password: PASSWORD }, h.ctx);
    expect(byPassword.level).toBe(1);
    const byCode = await reauthenticate(h.deps, byPassword.issued.session, { method: "recovery", recoveryCode: codes[0]! }, h.ctx);
    expect(byCode).toMatchObject({ level: 2, mustReenrollMfa: true });
    expect(byCode.issued.session).toMatchObject({ handle: session.handle, factors: { ...byPassword.issued.session.factors, recovery: h.clock.ms() } });
    expect(await h.deps.sessions.resolve(byPassword.issued.token)).toBeNull();
    expect(h.deps.sessions.level((await h.deps.sessions.resolve(byCode.issued.token))!.session)).toBe(2);
    // The code is spent.
    expect((await repo.findUserById(account.user.id))!.recoveryCodesHash).toHaveLength(9);
    await expect(reauthenticate(h.deps, byCode.issued.session, { method: "recovery", recoveryCode: codes[0]! }, h.ctx)).rejects.toMatchObject({ code: "invalid_mfa_code" });

    const events = await eventsOf(account.user.id);
    expect(events.filter((e) => e.type === "signin_failure").map((e) => [e.ipHash, e.metadata])).toEqual([
      [h.ctx.ipHash, { method: "recovery_code" }],
      [h.ctx.ipHash, { method: "recovery_code" }],
    ]);
    expect(events.filter((e) => e.type === "recovery_code_used").map((e) => [e.deviceId, e.ipHash])).toEqual([[account.session.deviceId, h.ctx.ipHash]]);
    expect(h.mailer.sent.filter((m) => m.template === "recovery_code_used").map((m) => m.to)).toEqual([account.email]);
  });

  test("me describes the signed-in account and its profile", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    await h.deps.profiles.create({ id: account.user.id, handle: "me_test", displayName: "Me Test" });
    expect(await me(h.deps, account.session)).toEqual({
      user: { id: account.user.id, email: account.email, role: "user", onboarded: true, mfaEnabled: false, hasPassword: true, passkeys: 0 },
      profile: { id: account.user.id, handle: "me_test", displayName: "Me Test", handleChangedAt: null, verified: false, showInExplore: true },
    });
  });

  test("sessions can be listed, revoked one at a time, signed out, and revoked all at once", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const second = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const third = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });

    // Each session is listed under its handle, the id a rotation keeps; the hash of a token is never listed.
    const { sessions } = await listSessions(h.deps, account.session);
    expect(sessions.map((s) => s.id).sort()).toEqual([account.session.handle, second.session.handle, third.session.handle].sort());
    expect(sessions.filter((s) => s.current).map((s) => s.id)).toEqual([account.session.handle]);

    // The listed session re-authenticates before the revoke lands, so its token rotates: the listed id still names it.
    const rotated = await reauthenticate(h.deps, second.session, { method: "password", password: PASSWORD }, h.ctx);
    expect(await h.deps.sessions.resolve(second.token)).toBeNull();
    expect(await h.deps.sessions.resolve(rotated.issued.token)).not.toBeNull();
    expect(await revokeSession(h.deps, account.session, second.session.handle)).toBe(true);
    expect(await h.deps.sessions.resolve(rotated.issued.token)).toBeNull();
    expect(await revokeSession(h.deps, account.session, second.session.handle)).toBe(false);
    expect(await revokeSession(h.deps, account.session, randomUUID())).toBe(false);
    // Another account's session is not this one's to revoke.
    const stranger = await onboardedUser(h, repo);
    expect(await revokeSession(h.deps, account.session, stranger.session.handle)).toBe(false);
    expect(await h.deps.sessions.resolve(stranger.token)).not.toBeNull();
    expect((await eventsOf(account.user.id)).filter((e) => e.type === "session_revoked")).toEqual([
      { type: "session_revoked", deviceId: account.session.deviceId, ipHash: null, metadata: { handle: second.session.handle } },
    ]);

    // Signing out after a rotation ends the session under its new token.
    const thirdRotated = await h.deps.sessions.rotate(third.session);
    await signOut(h.deps, thirdRotated.session);
    expect(await h.deps.sessions.resolve(thirdRotated.token)).toBeNull();

    const fourth = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    expect(await revokeAllSessions(h.deps, account.session)).toBe(2);
    expect(h.mailer.sent.filter((m) => m.template === "sessions_revoked_all").map((m) => m.data.count)).toEqual(["2"]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(fourth.token)).toBeNull();
    expect((await repo.recentEvents(account.user.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["session_revoked", "sessions_revoked_all"]));
  });

  test("'This wasn't me' locks the account down (every session and device, the password) once, and only for the address it was sent to", { timeout: 30_000 }, async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo, { password: PASSWORD });
    const other = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    const link = async (stored: NotMeToken) => {
      const token = randomToken();
      await h.kv.set(notMeKey(token), JSON.stringify(stored), 60_000);
      return token;
    };
    const key = h.deps.config.authHmacKey;
    const token = await link({ userId: account.user.id, deviceId: account.session.deviceId, signedInAt: h.clock.ms(), passkeyId: null, sentTo: emailHash(key, account.email) });

    await notMe(h.deps, { token }, h.ctx);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    expect(await h.deps.sessions.resolve(other.token)).toBeNull();
    expect(await repo.listDevices(account.user.id)).toEqual([]);
    expect((await repo.findUserById(account.user.id))!.passwordHash).toBeNull();
    const events = await eventsOf(account.user.id);
    expect(events.filter((e) => e.type === "not_me").map((e) => [e.deviceId, e.ipHash, e.metadata])).toEqual([
      [account.session.deviceId, h.ctx.ipHash, { passkeysRemoved: [], totpCleared: false, passwordCleared: true }],
    ]);
    await expect(notMe(h.deps, { token }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });

    // A link sent to an address the account has since left does nothing but refuse, and is not spent by the refusal.
    const moved = await onboardedUser(h, repo, { password: PASSWORD });
    const stale = await link({ userId: moved.user.id, deviceId: moved.session.deviceId, signedInAt: h.clock.ms(), passkeyId: null, sentTo: emailHash(key, moved.email) });
    await repo.changeEmail(moved.user.id, newTestEmail("moved"), h.clock.now());
    for (let i = 0; i < 2; i++) await expect(notMe(h.deps, { token: stale }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", status: 400, message: LINK_GONE });
    expect(await h.deps.sessions.resolve(moved.token)).not.toBeNull();
    expect((await repo.findUserById(moved.user.id))!.passwordHash).not.toBeNull();
    expect((await repo.recentEvents(moved.user.id)).map((e) => e.type)).not.toContain("not_me");
    // Once the account is back at the address the alert went to, as the email undo puts it, the link works, once.
    await repo.changeEmail(moved.user.id, moved.email, h.clock.now());
    await notMe(h.deps, { token: stale }, h.ctx);
    expect(await h.deps.sessions.resolve(moved.token)).toBeNull();
    expect((await repo.findUserById(moved.user.id))!.passwordHash).toBeNull();
    expect((await repo.recentEvents(moved.user.id)).map((e) => e.type).filter((type) => type === "not_me")).toHaveLength(1);
    await expect(notMe(h.deps, { token: stale }, h.ctx)).rejects.toMatchObject({ code: "invalid_code", message: LINK_GONE });
  });

  test("granting a role signs the account out everywhere so the new role applies at once", async () => {
    const h = flowHarness(repo);
    const account = await onboardedUser(h, repo);
    // The account held no staff session, link or key, so the change ends none and mails nothing (3a design, section 7).
    expect(await grantRole(h.deps, account.email.toUpperCase(), "moderator")).toEqual({
      userId: account.user.id,
      previousRole: "user",
      staffSessionsRevoked: 0,
      enrollmentsDeleted: 0,
      staffKeysRevoked: 0,
      mailError: null,
      tombstoneError: null,
    });
    expect(h.mailer.sent).toEqual([]);
    expect(await h.deps.sessions.resolve(account.token)).toBeNull();
    const again = await h.deps.sessions.issue(account.user.id, account.session.deviceId, { factors: { email: h.clock.ms() } });
    expect(again.session).toMatchObject({ role: "moderator", mfaEnabled: false });
    await expect(grantRole(h.deps, "nobody-at-all@korbat.local", "admin")).rejects.toThrow(/no account/);
  });
});
```

### Replace `apps/api/test/integration/cli-grant-role.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditHead, auditLog, closeDb, createDb, type Db } from "@korbat/db";
import { createAuthRepo, createSessions } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { SYSTEM_ACTOR_ID, runGrantRole } from "../../src/cli/grant-role";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { newUserWithDevice } from "./auth-fixtures";

describe.skipIf(!process.env.INTEGRATION)("integration: grant-role CLI", () => {
  let authDb: Db;
  let apiDb: Db;

  beforeAll(() => {
    const config = loadConfig();
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 2 });
    // Only for reading the record back: grant-role itself no longer opens the API's pool.
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb)]);
  });

  const readHead = async () => (await apiDb.select().from(auditHead))[0]!;

  test("grants a staff role, revokes every session and writes an audit entry", async () => {
    const repo = createAuthRepo(authDb);
    const kv = new MemoryKv();
    const sessions = createSessions({ repo, kv });
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: Date.now() } });
    expect(await sessions.resolve(issued.token)).not.toBeNull();

    const result = await runGrantRole({ authDb, kv, mailer: new MemoryMailer() }, user.email, "moderator");

    // An account without staff rows: nothing of the console to end, and no staff mail.
    expect(result).toEqual({ userId: user.id, previousRole: "user", staffSessionsRevoked: 0, enrollmentsDeleted: 0, staffKeysRevoked: 0, mailError: null, tombstoneError: null });
    expect((await repo.findUserById(user.id))!.role).toBe("moderator");
    expect(await sessions.resolve(issued.token)).toBeNull();
    const entries = await apiDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, user.id), eq(auditLog.action, "role_granted")));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: SYSTEM_ACTOR_ID, targetType: "user", metadata: { from: "user", to: "moderator", via: "cli", staffSessionsRevoked: 0, enrollmentsDeleted: 0 }, chainVersion: 1 });
    expect(await readHead()).toMatchObject({ seq: entries[0]!.chainSeq, hash: entries[0]!.hash });
  });

  test("the role change, the sessions it revokes and its audit row are one transaction", async () => {
    const repo = createAuthRepo(authDb);
    const kv = new MemoryKv();
    const sessions = createSessions({ repo, kv });
    const { user, device } = await newUserWithDevice(repo);
    await sessions.issue(user.id, device.id, { factors: { email: Date.now() } });

    await runGrantRole({ authDb, kv, mailer: new MemoryMailer() }, user.email, "admin");

    // Every row a transaction writes carries its transaction id in xmin: one id means one transaction, which committed
    // the role, the revocation and the row together or not at all.
    const [account] = await authDb.execute<{ xmin: string }>(sql`select xmin::text as xmin from auth.users where id = ${user.id}`);
    const revoked = await authDb.execute<{ xmin: string }>(sql`select xmin::text as xmin from auth.sessions where user_id = ${user.id}`);
    const [row] = await apiDb.execute<{ xmin: string }>(
      sql`select xmin::text as xmin from public.audit_log where target_id = ${user.id} and action = 'role_granted'`,
    );
    expect(revoked.length).toBe(1);
    expect(revoked[0]!.xmin).toBe(account!.xmin);
    expect(row!.xmin).toBe(account!.xmin);
  });

  test("an unknown email fails without writing an audit entry", async () => {
    const before = await apiDb.$count(auditLog);
    await expect(runGrantRole({ authDb, kv: new MemoryKv(), mailer: new MemoryMailer() }, `nobody-${randomUUID()}@korbat.local`, "admin")).rejects.toThrow("no account for");
    expect(await apiDb.$count(auditLog)).toBe(before);
  });

  test("while an open transaction holds the audit head, it gives up after 10 seconds having changed nothing, and says why", { timeout: 30_000 }, async () => {
    const repo = createAuthRepo(authDb);
    const kv = new MemoryKv();
    const sessions = createSessions({ repo, kv });
    const { user, device } = await newUserWithDevice(repo);
    const issued = await sessions.issue(user.id, device.id, { factors: { email: Date.now() } });
    const head = await readHead();

    // What a stalled or hostile API could do: an audit insert whose transaction stays open holds the head until it ends.
    const holder = createDb(loadConfig().DATABASE_URL_API, { max: 1 });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const stall = holder
      .transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        await tx.insert(auditLog).values({ actorId: SYSTEM_ACTOR_ID, action: "probe_stall" });
        holding();
        await released;
        throw new Error("rolled back on purpose");
      })
      .catch(() => undefined);
    try {
      await held;
      const started = Date.now();
      await expect(runGrantRole({ authDb, kv, mailer: new MemoryMailer() }, user.email, "moderator")).rejects.toThrow(
        /changed nothing: an open transaction holds the audit head or the account's row.*stop the api service/s,
      );
      expect(Date.now() - started).toBeGreaterThanOrEqual(9_000);
    } finally {
      release();
      await stall;
      await closeDb(holder);
    }
    expect((await repo.findUserById(user.id))!.role).toBe("user");
    expect(await sessions.resolve(issued.token)).not.toBeNull();
    expect(await readHead()).toEqual(head);
  });
});
```

### Replace `apps/api/test/integration/cli-staff-enroll.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditHead, auditLog, authEvents, closeDb, createDb, profiles, staffEnrollments, staffKeys, users, type Db } from "@korbat/db";
import { sha256Hex } from "../../src/auth/crypto";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { SYSTEM_ACTOR_ID } from "../../src/cli/grant-role";
import { checkAuditRecord, runStaffCommand } from "../../src/cli/staff";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { flowHarness } from "./flow-harness";
import { enrolKey } from "./staff-enrolment";
import { TEST_CONSOLE, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, addStaffKey, issueEnrolment, newStaffAccount, rolledBack, withLockTimeout } from "./staff-fixtures";

/** A link as `staff.js enroll` prints it, on a line of its own: the console's enrolment page and the 43-character token. */
const LINK = new RegExp(`^${TEST_CONSOLE_ORIGIN.replace(/[.]/g, "[.]")}/enroll/([A-Za-z0-9_-]{43})$`, "m");

/**
 * The staff command line's enrolment and key listing against the real database (3a design, section 7): `staff.js enroll`
 * runs as the migrator in the migrate service with nothing but the migrator's URL and the console's origin and relying
 * party ID, and `staff.js keys` reads the keys on the auth role and the handles on the API role.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff.js enroll and keys", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  /** What the migrate service holds for enroll, and nothing else (Compose gives it these three). */
  const enrollEnv = (extra: Record<string, string> = {}) => ({ DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE!, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, ...extra });
  /** What keys needs: the two roles' URLs, as the api service holds them. */
  const keysEnv = () => ({ DATABASE_URL_API: process.env.DATABASE_URL_API!, DATABASE_URL_AUTH: process.env.DATABASE_URL_AUTH! });

  /** The command's printed lines, each marked with its stream, and its exit code, for a run that sees `env` alone. */
  async function cli(args: string[], env: Record<string, string>) {
    const lines: string[] = [];
    const code = await runStaffCommand(args, env, { log: (line) => lines.push(`out ${line}`), error: (line) => lines.push(`err ${line}`) });
    return { code, lines, text: lines.join("\n") };
  }

  const head = async () => (await migrateDb.select().from(auditHead))[0]!;
  const enrolmentsOf = (userId: string) => migrateDb.select().from(staffEnrollments).where(eq(staffEnrollments.userId, userId));
  const issuedEvents = (userId: string) =>
    migrateDb.select().from(authEvents).where(and(eq(authEvents.userId, userId), eq(authEvents.type, "staff_enrollment_issued")));

  /** A staff account with a handle that its profile shows, as onboarding leaves it. */
  async function staffWithHandle(role: "moderator" | "admin" = "moderator") {
    const account = await newStaffAccount(authDb, repo, role);
    const handle = `s_${randomUUID().slice(0, 8)}`;
    await apiDb.insert(profiles).values({ id: account.user.id, handle, displayName: "Staff" });
    return { ...account, handle };
  }

  describe("enroll", () => {
    test("prints a one-time link for 30 minutes and writes the enrolment, its auth event and its audit row in one transaction", { timeout: 30_000 }, async () => {
      const { user } = await staffWithHandle();
      const before = await head();
      // The address as an operator might type it: the command normalises it.
      const run = await cli(["enroll", user.email.toUpperCase()], enrollEnv());
      expect(run.code, run.text).toBe(0);
      expect(run.lines.every((line) => line.startsWith("out "))).toBe(true);
      const token = LINK.exec(run.lines.map((line) => line.slice(4)).join("\n"))?.[1];
      expect(token, run.text).toBeDefined();
      expect(run.text).toContain(user.email);
      expect(run.text).toMatch(/30 minutes/);

      // Only the token's sha256 is kept, with the console's origin and relying party ID, unused, for 30 minutes.
      const [enrolment, ...others] = await enrolmentsOf(user.id);
      expect(others).toEqual([]);
      expect(enrolment).toMatchObject({ tokenHash: sha256Hex(token!), origin: TEST_CONSOLE_ORIGIN, rpId: TEST_CONSOLE_RP_ID, usedAt: null });
      expect(enrolment!.expiresAt.getTime() - enrolment!.createdAt.getTime()).toBe(30 * 60_000);

      const [event] = await issuedEvents(user.id);
      expect(event).toMatchObject({ type: "staff_enrollment_issued", metadata: { enrollmentId: enrolment!.id, via: "cli" } });
      const rows = await migrateDb.select().from(auditLog).where(and(eq(auditLog.action, "staff_enrollment_issued"), eq(auditLog.targetId, user.id)));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorId: SYSTEM_ACTOR_ID, targetType: "user", metadata: { enrollmentId: enrolment!.id, via: "cli" }, requestId: null });
      // The audit row was the transaction's last statement: it holds the head, which names it.
      expect(rows[0]!.chainSeq).toBe(before.seq + 1);
      expect(await head()).toMatchObject({ seq: rows[0]!.chainSeq, hash: rows[0]!.hash });
      const [xmins] = await migrateDb.execute<{ enrolment: string; event: string; audit: string }>(sql`select
        (select xmin::text from auth.staff_enrollments where id = ${enrolment!.id}) as enrolment,
        (select xmin::text from auth.auth_events where id = ${event!.id}) as event,
        (select xmin::text from public.audit_log where id = ${rows[0]!.id}) as audit`);
      expect(new Set([xmins!.enrolment, xmins!.event, xmins!.audit]).size).toBe(1);

      // The link enrols a key through the console's flows, with the origin and relying party ID it was issued for.
      const h = flowHarness(repo, { console: TEST_CONSOLE });
      const { key } = await enrolKey(h, new SoftAuthenticator(), token!);
      const [stored] = await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, key.id));
      expect(stored).toMatchObject({ userId: user.id, origin: TEST_CONSOLE_ORIGIN, rpId: TEST_CONSOLE_RP_ID });
      // Nothing it wrote breaks the record.
      await rolledBack(apiDb, async (tx) => {
        const report = await checkAuditRecord(tx, [], authDb);
        expect(report.problems).toEqual([]);
      });
    });

    test("records CONSOLE_RP_ID when it is given, and the console's hostname when it is blank", async () => {
      const { user } = await staffWithHandle("admin");
      expect((await cli(["enroll", user.email], enrollEnv({ CONSOLE_RP_ID: "" }))).code).toBe(0);
      expect((await cli(["enroll", user.email], enrollEnv({ CONSOLE_RP_ID: "Console.Localhost" }))).code).toBe(0);
      const rows = await enrolmentsOf(user.id);
      expect(rows.map((row) => [row.origin, row.rpId])).toEqual([
        [TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID],
        [TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID],
      ]);
    });

    test("refuses an account that is unknown, deleted, not staff, without a handle or with 5 live keys, and writes nothing", { timeout: 30_000 }, async () => {
      const unknown = `nobody-${randomUUID()}@korbat.local`;
      const deleted = await staffWithHandle();
      await authDb.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deleted.user.id));
      const plain = await staffWithHandle();
      await authDb.update(users).set({ role: "user" }).where(eq(users.id, plain.user.id));
      const unnamed = await staffWithHandle();
      await authDb.update(users).set({ onboardedAt: null }).where(eq(users.id, unnamed.user.id));
      const full = await staffWithHandle();
      for (let i = 0; i < 5; i++) await addStaffKey(authDb, (await issueEnrolment(migrateDb, full.user.id)).token);
      const fullEnrolments = (await enrolmentsOf(full.user.id)).length;

      const before = await head();
      const cases: [string, string, RegExp][] = [
        ["unknown", unknown, /no live account/],
        ["deleted", deleted.user.email, /no live account/],
        ["not staff", plain.user.email, /not staff/],
        ["without a handle", unnamed.user.email, /no handle/],
        ["five live keys", full.user.email, /5 live staff keys/],
      ];
      for (const [label, email, reason] of cases) {
        const run = await cli(["enroll", email], enrollEnv());
        expect([label, run.code]).toEqual([label, 1]);
        expect(run.text, label).toMatch(reason);
        expect(run.text, label).not.toMatch(/\/enroll\//);
      }
      for (const account of [deleted, plain, unnamed]) {
        expect(await enrolmentsOf(account.user.id)).toEqual([]);
        expect(await issuedEvents(account.user.id)).toEqual([]);
      }
      expect(await enrolmentsOf(full.user.id)).toHaveLength(fullEnrolments);
      expect(await head()).toEqual(before);
    });

    test("a revoked key does not count towards the five", async () => {
      const { user } = await staffWithHandle();
      const keys = [];
      for (let i = 0; i < 5; i++) keys.push(await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token));
      await authDb.update(staffKeys).set({ revokedAt: new Date() }).where(eq(staffKeys.id, keys[0]!.id));
      const run = await cli(["enroll", user.email], enrollEnv());
      expect(run.code, run.text).toBe(0);
    });

    test("while CONSOLE_ORIGIN is unset it says so, answers 1 and writes nothing", async () => {
      const { user } = await staffWithHandle();
      const before = await head();
      for (const env of [{ DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE! }, enrollEnv({ CONSOLE_ORIGIN: " " })]) {
        const run = await cli(["enroll", user.email], env);
        expect(run.code).toBe(1);
        expect(run.text).toMatch(/^err .*CONSOLE_ORIGIN is not set/);
      }
      expect(await enrolmentsOf(user.id)).toEqual([]);
      expect(await head()).toEqual(before);
    });

    test("while an open transaction holds the account's row, it gives up after 10 seconds having written nothing, and says why", { timeout: 30_000 }, async () => {
      const { user } = await staffWithHandle();
      const before = await head();
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let holding!: () => void;
      const held = new Promise<void>((resolve) => (holding = resolve));
      // What a stalled or hostile API could do: a transaction that took the account's row and stays open.
      const stall = withLockTimeout(authDb, async (tx) => {
        await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("no key update");
        holding();
        await released;
      });
      try {
        await held;
        const started = Date.now();
        const run = await cli(["enroll", user.email], enrollEnv());
        expect(run.code).toBe(1);
        expect(run.text).toMatch(/enroll: an open transaction holds the audit head or the account's row.*stop the api service/s);
        expect(Date.now() - started).toBeGreaterThanOrEqual(9_000);
      } finally {
        release();
        await stall;
      }
      expect(await enrolmentsOf(user.id)).toEqual([]);
      expect(await head()).toEqual(before);
    });
  });

  describe("keys", () => {
    test("lists one account's keys with their ids, names, reported AAGUIDs, dates and state", { timeout: 30_000 }, async () => {
      const { user, handle } = await staffWithHandle();
      const live = await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token, { name: "Blue key", aaguid: "ee882879-721c-4913-9775-3dfcce97072a" });
      // A key whose authenticator withheld its make reports the zero AAGUID.
      const withheld = await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token, { name: "Red key", aaguid: "00000000-0000-0000-0000-000000000000" });
      const revokedAt = new Date("2026-10-01T09:30:00.000Z");
      await authDb.update(staffKeys).set({ revokedAt, suspectAt: revokedAt, lastUsedAt: revokedAt }).where(eq(staffKeys.id, withheld.id));
      const [liveRow] = await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, live.id));

      const run = await cli(["keys", user.email], keysEnv());
      expect(run.code, run.text).toBe(0);
      expect(run.lines[0]).toBe(`out moderator ${user.email} @${handle} (account ${user.id})`);
      expect(run.text).toContain(`key ${live.id} "Blue key": AAGUID ee882879-721c-4913-9775-3dfcce97072a, created ${liveRow!.createdAt.toISOString()}, last used never, live`);
      expect(run.text).toContain(
        `key ${withheld.id} "Red key": AAGUID 00000000-0000-0000-0000-000000000000, created`,
      );
      expect(run.text).toContain(`last used ${revokedAt.toISOString()}, revoked ${revokedAt.toISOString()}, suspect ${revokedAt.toISOString()}`);
      // Never a public key or a credential id.
      expect(run.text).not.toContain(live.credentialId);
      expect(run.text).not.toContain("cose-key");
    });

    test("without an email lists every staff account with its role, address and handle, and no other account", { timeout: 30_000 }, async () => {
      const moderator = await staffWithHandle("moderator");
      const admin = await staffWithHandle("admin");
      await addStaffKey(authDb, (await issueEnrolment(migrateDb, admin.user.id)).token, { name: "Desk key" });
      const plain = await staffWithHandle();
      await authDb.update(users).set({ role: "user" }).where(eq(users.id, plain.user.id));
      const unnamed = await newStaffAccount(authDb, repo, "admin");

      const run = await cli(["keys"], keysEnv());
      expect(run.code, run.text).toBe(0);
      expect(run.lines).toContain(`out moderator ${moderator.user.email} @${moderator.handle} (account ${moderator.user.id})`);
      expect(run.lines).toContain(`out admin ${admin.user.email} @${admin.handle} (account ${admin.user.id})`);
      expect(run.lines).toContain(`out admin ${unnamed.user.email} (no handle) (account ${unnamed.user.id})`);
      expect(run.text).not.toContain(plain.user.email);
      // Each account's keys follow it; one without keys says so.
      const at = run.lines.indexOf(`out admin ${admin.user.email} @${admin.handle} (account ${admin.user.id})`);
      expect(run.lines[at + 1]).toMatch(/^out {3}key [0-9a-f-]{36} "Desk key": /);
      const bare = run.lines.indexOf(`out moderator ${moderator.user.email} @${moderator.handle} (account ${moderator.user.id})`);
      expect(run.lines[bare + 1]).toBe("out   no staff keys");
    });

    test("while an open transaction holds a table it reads, it gives up after 10 seconds and says why, on either role", { timeout: 60_000 }, async () => {
      // What an API under an attacker's control could do: its roles may lock any table they can update, and keys is the
      // runbook's own check against such an API, so it must never wait without limit.
      const { user } = await staffWithHandle();
      for (const [db, table] of [
        [authDb, sql`auth.users`],
        [apiDb, sql`public.profiles`],
      ] as const) {
        let release!: () => void;
        const released = new Promise<void>((resolve) => (release = resolve));
        let holding!: () => void;
        const held = new Promise<void>((resolve) => (holding = resolve));
        const stall = withLockTimeout(db, async (tx) => {
          await tx.execute(sql`lock table ${table} in access exclusive mode`);
          holding();
          await released;
        });
        try {
          await held;
          const started = Date.now();
          const run = await cli(["keys", user.email], keysEnv());
          expect(run.code, run.text).toBe(1);
          expect(run.text).toMatch(/keys: an open transaction holds .*stop the api service/s);
          expect(Date.now() - started).toBeGreaterThanOrEqual(9_000);
        } finally {
          release();
          await stall;
        }
      }
    });

    test("an unknown address is an error, and keys needs both roles' URLs and nothing else", async () => {
      const run = await cli(["keys", `nobody-${randomUUID()}@korbat.local`], keysEnv());
      expect(run.code).toBe(1);
      expect(run.text).toMatch(/^err keys: no live account for nobody-/);
      const missing = await cli(["keys"], { DATABASE_URL_API: process.env.DATABASE_URL_API! });
      expect(missing.code).toBe(1);
      expect(missing.text).toMatch(/DATABASE_URL_AUTH/);
    });
  });
});
```

### Replace `apps/api/test/integration/http-staff-sessions.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  AuditPage,
  ErrorEnvelope,
  STAFF_STEP_UP_CHALLENGE,
  StaffKeysResponse,
  StaffMe,
  StaffSessionsResponse,
  StaffSignInOptionsResponse,
  StaffSignInVerifyResponse,
  StaffStepUpOptionsResponse,
  stepUpActionHash,
  stepUpBinding,
  type AuthenticationResponseJSON,
} from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, profiles, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { createApp } from "../../src/app";
import { createAuth, revokeStaffKeys, type Auth } from "../../src/auth";
import { decodeKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { challengeKey, issueChallenge, issueStepUpChallenge } from "../../src/auth/passkeys/challenge";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { runGrantRole } from "../../src/cli/grant-role";
import { loadConfig, type Config } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { createStaff } from "../../src/staff";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { fakeClock } from "./auth-fixtures";
import { Browser, randomIp } from "./http-client";
import { DEVICE_BOUND, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";
import { enrolKey } from "./staff-enrolment";
import { revokeRequest } from "./staff-step-up";

const CONSOLE_HOST = new URL(TEST_CONSOLE_ORIGIN).host;
const STAFF_COOKIE = "__Host-korbat_staff";
const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
/** The mark the console sends on a request its person's action started (3a design, section 7). */
const MARKED = { "x-staff-activity": "1" };

/** The Set-Cookie lines of an answer, by cookie name. */
function setCookies(res: Response): Map<string, string> {
  return new Map(res.headers.getSetCookie().map((line) => [line.slice(0, line.indexOf("=")), line]));
}

const accessControlHeaders = (res: Response) => [...res.headers.keys()].filter((name) => name.startsWith("access-control-"));

/** A response's signature with its last byte changed. */
function badSignature(response: AuthenticationResponseJSON): AuthenticationResponseJSON {
  const signature = Buffer.from(response.response.signature, "base64url");
  signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
  return { ...response, response: { ...response.response, signature: signature.toString("base64url") } };
}

/**
 * Staff sessions over HTTP (3a design, sections 7 and 12): the console's own browser on http://console.localhost:8090 signs
 * in with a staff key, and every staff request after it passes the staff gate and requireStaff, which reads the session
 * from the database each time. The auth module runs on a clock the tests move, so the idle and absolute ends are reached
 * without waiting.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff sessions over HTTP", () => {
  let config: Config;
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;
  const mailer = new MemoryMailer();
  const clock = fakeClock();

  beforeAll(() => {
    // The test environment with the console switched on at the staff harness's address.
    config = loadConfig({ ...process.env, CONSOLE_ORIGIN: TEST_CONSOLE_ORIGIN, CONSOLE_RP_ID: "" });
    const logger = pino({ level: "silent" });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
    auth = createAuth({ config, logger, authDb, kv: new MemoryKv(clock.ms), mailer, profiles: createProfileStore(apiDb), now: clock.now });
    const staff = createStaff({ apiDb, auth: auth.forStaff });
    app = createApp({ config, logger, rateLimitStore: new MemoryStore(), healthChecks: {}, auth, staff });
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  /** The console's page: its own host and origin, echoing the staff CSRF cookie in the staff CSRF header. */
  const consoleBrowser = () => new Browser(app, TEST_CONSOLE_ORIGIN, { base: TEST_CONSOLE_ORIGIN, csrfCookie: STAFF_CSRF_COOKIE, csrfHeader: "x-staff-csrf" });
  /** A request to the console's host with exactly these headers, for what the browser above never sends. */
  const raw = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    app.request(`${TEST_CONSOLE_ORIGIN}${path}`, { method: init.method ?? "GET", headers: { host: CONSOLE_HOST, "cf-connecting-ip": randomIp(), ...init.headers } });
  const error = async (res: Response) => ErrorEnvelope.parse(await res.json()).error;
  const sessionRow = async (token: string) => (await migrateDb.select().from(staffSessions).where(eq(staffSessions.id, sha256Hex(token))))[0]!;
  const head = async () => (await migrateDb.select().from(auditHead))[0]!;

  /** The 401 that ends a staff session in the console: staff_session_required, with both staff cookies cleared. */
  async function expectEnded(res: Response, label: string) {
    expect(res.status, label).toBe(401);
    const cookies = setCookies(res);
    expect([...cookies.keys()].sort(), label).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
    for (const line of cookies.values()) {
      expect(line, label).toContain("Max-Age=0");
      expect(line, label).toContain("Path=/");
      expect(line, label).toContain("Secure");
    }
    expect((await error(res)).code, label).toBe("staff_session_required");
  }

  /**
   * A live staff account with a handle and one key enrolled through the flow, signed in from the console's browser with
   * Firefox's user agent. `signIn` signs in again, from any browser, with the next counter unless told one.
   */
  async function staffBrowser(role: "moderator" | "admin" = "moderator") {
    const { user, device } = await newStaffAccount(authDb, repo, role);
    const handle = `s_${randomUUID().slice(0, 8)}`;
    await apiDb.insert(profiles).values({ id: user.id, handle, displayName: "Staff" });
    const soft = new SoftAuthenticator();
    // The flows run on the moved clock: the link is valid 30 minutes from it, which is never earlier than the database's.
    const link = await issueEnrolment(migrateDb, user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) });
    const enrolled = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, soft, link.token);
    let counter = 0;
    async function signIn(browser: Browser, options: { counter?: number; headers?: Record<string, string> } = {}) {
      const answer = await browser.fetch("/api/staff/signin/options", { method: "POST" });
      expect(answer.status, await answer.clone().text()).toBe(200);
      const { options: request } = StaffSignInOptionsResponse.parse(await answer.json());
      counter = options.counter ?? counter + 1;
      const response = soft.get({ credentialId: enrolled.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge: request.challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter });
      const res = await browser.fetch("/api/staff/signin/verify", { json: { response }, headers: options.headers });
      return { res, response };
    }
    const b = consoleBrowser();
    const first = await signIn(b, { headers: { "user-agent": FIREFOX_LINUX } });
    expect(first.res.status, await first.res.clone().text()).toBe(200);
    return { user, device, handle, soft, keyId: enrolled.key.id, credentialId: enrolled.credentialId, b, token: b.cookie(STAFF_COOKIE)!, signIn, first };
  }

  /**
   * The key's answer to step-up options for revoking the staff session `handle`, asked for from `s`'s browser as the
   * console asks for them, or over a challenge of the test's own.
   */
  async function confirmation(s: Awaited<ReturnType<typeof staffBrowser>>, handle: string, options: { counter: number; challenge?: string }) {
    let challenge = options.challenge;
    if (challenge === undefined) {
      const res = await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(handle), headers: MARKED });
      expect(res.status, await res.clone().text()).toBe(200);
      challenge = StaffStepUpOptionsResponse.parse(await res.json()).options.challenge;
    }
    return s.soft.get({ credentialId: s.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: options.counter });
  }
  const revokeSession = (b: Browser, handle: string, stepUp?: AuthenticationResponseJSON) =>
    b.fetch(`/api/staff/sessions/${handle}`, { method: "DELETE", ...(stepUp ? { json: { stepUp } } : {}), headers: MARKED });

  describe("signing in", () => {
    test("sets both staff cookies, __Host-, Secure, Path=/, SameSite=Strict and 12 hours long, the session's HttpOnly; answers /me's body with no CORS header and no-store", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const res = s.first.res;
      const cookies = setCookies(res);
      expect([...cookies.keys()].sort()).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
      const session = cookies.get(STAFF_COOKIE)!;
      const csrf = cookies.get(STAFF_CSRF_COOKIE)!;
      expect(session).toMatch(/^__Host-korbat_staff=[A-Za-z0-9_-]{43};/);
      expect(csrf).toMatch(/^__Host-korbat_staff_csrf=[A-Za-z0-9_-]{43};/);
      for (const line of [session, csrf]) {
        for (const attribute of ["Max-Age=43200", "Path=/", "Secure", "SameSite=Strict"]) expect(line).toContain(attribute);
        expect(line).not.toContain("Domain=");
      }
      expect(session).toContain("HttpOnly");
      expect(csrf).not.toContain("HttpOnly");
      // No app cookie is set on the console.
      expect(res.headers.getSetCookie().some((line) => line.startsWith("__Host-korbat_session=") || line.startsWith("__Host-korbat_csrf="))).toBe(false);
      expect(accessControlHeaders(res)).toEqual([]);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const me = StaffSignInVerifyResponse.parse(await res.json());
      const row = await sessionRow(s.token);
      expect(me).toMatchObject({ handle: s.handle, role: "moderator", sessionHandle: row.handle, idleSecondsLeft: 900, absoluteSecondsLeft: 43_200 });
      // The coarse label of the browser that signed in, never its user agent, as the session list and the mail show it.
      expect(row.browser).toBe("Firefox on Linux");
      expect(mailer.sent.filter((m) => m.to === s.user.email).map((m) => [m.template, m.data.browser])).toEqual([
        ["staff_key_added", undefined],
        ["staff_session_started", "Firefox on Linux"],
      ]);
    });

    test("one answer before the signature: a spent challenge, one of another purpose, one with another binding and a bad signature are staff_key_invalid, never a passkey code, and a bad signature on a live key reads as an unknown key", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const b = consoleBrowser();
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const fresh = async () => StaffSignInOptionsResponse.parse(await (await b.fetch("/api/staff/signin/options", { method: "POST" })).json()).options.challenge;
      const assert = (challenge: string, counter: number) =>
        s.soft.get({ credentialId: s.credentialId, rpId: TEST_CONSOLE_RP_ID, challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter });
      const spentChallenge = JSON.parse(Buffer.from(s.first.response.response.clientDataJSON, "base64url").toString()).challenge as string;
      const stranger = new SoftAuthenticator();
      const unknown = stranger.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });

      const cases: [string, AuthenticationResponseJSON][] = [
        ["a spent challenge", assert(spentChallenge, 20)],
        ["the app's sign-in challenge", assert(issueChallenge(key, "signin", clock.now()), 21)],
        ["a staff registration challenge", assert(issueChallenge(key, "staff_register", clock.now(), randomUUID()), 22)],
        ["a staff sign-in challenge with a binding", assert(issueChallenge(key, "staff_signin", clock.now(), randomUUID()), 23)],
        ["a bad signature on a live key", badSignature(assert(await fresh(), 24))],
        ["an unknown key", stranger.get({ credentialId: unknown.id, rpId: TEST_CONSOLE_RP_ID, challenge: await fresh(), origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: 1 })],
      ];
      const answers: Record<string, { status: number; code: string; message: string }> = {};
      for (const [label, response] of cases) {
        const res = await b.fetch("/api/staff/signin/verify", { json: { response } });
        const { code, message } = await error(res);
        answers[label] = { status: res.status, code, message };
        expect([label, res.status, code]).toEqual([label, 401, "staff_key_invalid"]);
        expect(code, label).not.toMatch(/^passkey_/);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect(answers["a bad signature on a live key"]).toEqual(answers["an unknown key"]);
      expect((await migrateDb.select().from(staffSessions).where(eq(staffSessions.userId, s.user.id))).length).toBe(1);
    });
  });

  describe("the person's own reads", () => {
    test("/me with the seconds left, /sessions with every live session and this one marked, /keys with the live keys and never a public key; no answer sets a cookie", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      // Another account's session is never listed, nor a key the account no longer holds.
      await staffBrowser();
      const red = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, s.soft, (await issueEnrolment(migrateDb, s.user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) })).token, { name: "Red key" });
      const old = await enrolKey({ deps: auth.deps, ctx: { ipHash: randomToken(), userAgent: undefined } }, s.soft, (await issueEnrolment(migrateDb, s.user.id, { expiresAt: new Date(clock.ms() + 30 * MINUTE) })).token, { name: "Old key" });
      await authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, old.key.id));
      clock.advance(MINUTE);

      for (const headers of [{}, MARKED]) {
        const me = await s.b.fetch("/api/staff/me", { headers });
        expect(me.status).toBe(200);
        expect(me.headers.getSetCookie()).toEqual([]);
        const body = StaffMe.parse(await me.json());
        expect(body.sessionHandle).toBe((await sessionRow(s.token)).handle);
        expect(body.absoluteSecondsLeft).toBe(12 * 60 * 60 - 60);
      }

      const sessions = await s.b.fetch("/api/staff/sessions");
      expect(sessions.headers.getSetCookie()).toEqual([]);
      const listed = StaffSessionsResponse.parse(await sessions.json()).sessions;
      const mine = await sessionRow(s.token);
      const theirs = await sessionRow(other.cookie(STAFF_COOKIE)!);
      expect(listed.map((x) => [x.handle, x.current, x.browser]).sort()).toEqual(
        [
          [mine.handle, true, "Firefox on Linux"],
          [theirs.handle, false, "Browser on unknown OS"],
        ].sort(),
      );
      // The other browser sees the same two, with its own marked.
      const fromOther = StaffSessionsResponse.parse(await (await other.fetch("/api/staff/sessions")).json()).sessions;
      expect(fromOther.find((x) => x.current)!.handle).toBe(theirs.handle);

      const keys = await s.b.fetch("/api/staff/keys");
      const text = await keys.clone().text();
      expect(StaffKeysResponse.parse(await keys.json()).keys.map((k) => [k.id, k.name])).toEqual([
        [s.keyId, "Blue key"],
        [red.key.id, "Red key"],
      ]);
      // The key that signed in shows when it was last used; nothing of any key's credential leaves the server.
      const [blue] = await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, s.keyId));
      expect(text).toContain(blue!.lastUsedAt!.toISOString());
      for (const secret of [blue!.publicKey, blue!.credentialId]) expect(text).not.toContain(secret);
    });
  });

  describe("the idle and absolute limits", () => {
    test("only marked requests count: unmarked reads neither slide the idle end nor move last_used_at, so the session ends 15 minutes after the last marked one", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const t0 = (await sessionRow(s.token)).createdAt.getTime();
      clock.advance(10 * MINUTE);
      const unmarked = await s.b.fetch("/api/staff/me");
      expect(StaffMe.parse(await unmarked.json()).idleSecondsLeft).toBe(5 * 60);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0), idleExpiresAt: new Date(t0 + 15 * MINUTE) });

      clock.advance(4 * MINUTE);
      const marked = await s.b.fetch("/api/staff/me", { headers: MARKED });
      expect(StaffMe.parse(await marked.json()).idleSecondsLeft).toBe(15 * 60);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE) });

      // Any other value of the header marks nothing.
      clock.advance(MINUTE);
      expect((await s.b.fetch("/api/staff/sessions", { headers: { "x-staff-activity": "true" } })).status).toBe(200);
      clock.advance(13 * MINUTE);
      expect((await s.b.fetch("/api/staff/keys")).status).toBe(200);
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE) });

      // At the idle end, the next request is refused and the cookies cleared; a marked one revives nothing.
      clock.advance(MINUTE);
      await expectEnded(await s.b.fetch("/api/staff/me"), "at the idle end");
      expect(s.b.cookie(STAFF_COOKIE)).toBeUndefined();
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, ...MARKED } }), "marked, after the idle end");
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 14 * MINUTE), idleExpiresAt: new Date(t0 + 29 * MINUTE), revokedAt: null });
    });

    test("a marked request slides the idle end, never past the absolute end, which ends the session after 12 hours whatever its person does", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const row = await sessionRow(s.token);
      const t0 = row.createdAt.getTime();
      expect(row.absoluteExpiresAt).toEqual(new Date(t0 + 12 * HOUR));
      // A marked request every 14 minutes for 11 hours and 54 minutes.
      for (let i = 0; i < 51; i++) {
        clock.advance(14 * MINUTE);
        expect((await s.b.fetch("/api/staff/me", { headers: MARKED })).status, `request ${i}`).toBe(200);
      }
      expect(await sessionRow(s.token)).toMatchObject({ lastUsedAt: new Date(t0 + 714 * MINUTE), idleExpiresAt: new Date(t0 + 12 * HOUR) });
      const me = StaffMe.parse(await (await s.b.fetch("/api/staff/me", { headers: MARKED })).json());
      expect([me.idleSecondsLeft, me.absoluteSecondsLeft]).toEqual([6 * 60, 6 * 60]);
      expect(me.idleExpiresAt).toBe(me.absoluteExpiresAt);
      clock.advance(6 * MINUTE);
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}` } }), "unmarked, at the absolute end");
      await expectEnded(await s.b.fetch("/api/staff/me", { headers: MARKED }), "at the absolute end");
    });
  });

  describe("every way a session ends, refused at its next request", () => {
    type Ender = [string, (s: Awaited<ReturnType<typeof staffBrowser>>) => Promise<void>];
    const enders: Ender[] = [
      ["a revocation by the command line", async (s) => void (await revokeStaffKeys({ repo, mailer }, s.user.email, s.keyId))],
      ["a revocation of every key by the command line", async (s) => void (await revokeStaffKeys({ repo, mailer }, s.user.email, "all"))],
      [
        "a counter that went backwards in another browser",
        async (s) => {
          const { res } = await s.signIn(consoleBrowser(), { counter: 1 });
          expect((await error(res)).code).toBe("staff_key_suspended");
        },
      ],
      ["a demotion by grant-role", async (s) => void (await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, s.user.email, "user"))],
      ["a change from moderator to admin", async (s) => void (await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, s.user.email, "admin"))],
      ["the account's take-down", async (s) => void (await repo.takeDown(s.user.id, clock.now(), null))],
      // Changes that revoke nothing: the session is read with its key and its account at every request, so no tombstone is needed.
      ["its key revoked in the database alone", async (s) => void (await authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, s.keyId)))],
      ["the account's role set to user in the database alone", async (s) => void (await authDb.update(users).set({ role: "user" }).where(eq(users.id, s.user.id)))],
      ["the account marked deleted in the database alone", async (s) => void (await authDb.update(users).set({ deletedAt: clock.now() }).where(eq(users.id, s.user.id)))],
      ["the session revoked in the database", async (s) => void (await authDb.update(staffSessions).set({ revokedAt: clock.now() }).where(eq(staffSessions.id, sha256Hex(s.token))))],
      [
        "a revocation confirmed with the key in another browser",
        async (s) => {
          const other = consoleBrowser();
          expect((await s.signIn(other)).res.status).toBe(200);
          const handle = (await sessionRow(s.token)).handle;
          const stepUp = await confirmation({ ...s, b: other }, handle, { counter: 3 });
          expect((await revokeSession(other, handle, stepUp)).status).toBe(204);
        },
      ],
      [
        "a counter that went backwards at a step-up",
        async (s) => {
          const handle = (await sessionRow(s.token)).handle;
          const res = await revokeSession(s.b, handle, await confirmation(s, handle, { counter: 1 }));
          expect([res.status, (await error(res)).code]).toEqual([403, "staff_key_suspended"]);
        },
      ],
    ];
    for (const [label, end] of enders) {
      test(label, { timeout: 30_000 }, async () => {
        const s = await staffBrowser();
        expect((await s.b.fetch("/api/staff/me")).status).toBe(200);
        await end(s);
        // Both of requireStaff's reads refuse it: the plain read (no mark, as the console's idle timer and 3c's refreshes
        // read) and the marked one, which slides the idle end in the same statement. Each is sent with the token by hand,
        // since the first 401 clears the browser's cookies; then the browser's own request.
        await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}` } }), `${label}, unmarked`);
        await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, ...MARKED } }), `${label}, marked`);
        await expectEnded(await s.b.fetch("/api/staff/me", { headers: MARKED }), label);
        expect(s.b.cookie(STAFF_COOKIE)).toBeUndefined();
        expect(s.b.cookie(STAFF_CSRF_COOKIE)).toBeUndefined();
      });
    }

    test("signing out: 204, both cookies cleared, the session revoked with staff_signed_out and its audit row, and no mail", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const row = await sessionRow(s.token);
      const sent = mailer.sent.length;
      const before = await head();
      clock.advance(MINUTE);
      const res = await s.b.fetch("/api/staff/signout", { method: "POST" });
      expect(res.status).toBe(204);
      const cookies = setCookies(res);
      expect([...cookies.keys()].sort()).toEqual([STAFF_COOKIE, STAFF_CSRF_COOKIE]);
      for (const line of cookies.values()) expect(line).toContain("Max-Age=0");
      expect((await sessionRow(s.token)).revokedAt).toEqual(clock.now());

      const [event] = await migrateDb
        .select({ metadata: authEvents.metadata })
        .from(authEvents)
        .where(and(eq(authEvents.userId, s.user.id), eq(authEvents.type, "staff_signed_out")));
      expect(event!.metadata).toEqual({ handle: row.handle });
      const written = await migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, before.seq)).orderBy(asc(auditLog.chainSeq));
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.staffSession, r.keyId, r.requestId, r.metadata])).toEqual([
        ["staff_signed_out", s.user.id, "staff_session", row.handle, row.handle, s.keyId, res.headers.get("x-request-id"), {}],
      ]);
      expect(mailer.sent.length).toBe(sent);
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}` } }), "after signing out");
      // Signing out again is a session that has ended.
      await expectEnded(await raw("/api/staff/signout", { method: "POST", headers: { origin: TEST_CONSOLE_ORIGIN, cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=x`, "x-staff-csrf": "x" } }), "signing out twice");
    });
  });

  describe("revoking a session, confirmed with the staff key", () => {
    test("the options name the session's key alone over a challenge the console can check; DELETE with the confirmation answers 204, the session ends at its next request, and the row carries the request's id and the confirmation", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const request = revokeRequest(target.handle);

      const optionsRes = await s.b.fetch("/api/staff/step-up/options", { json: request, headers: MARKED });
      expect(optionsRes.status).toBe(200);
      expect(accessControlHeaders(optionsRes)).toEqual([]);
      expect(optionsRes.headers.getSetCookie()).toEqual([]);
      const { options } = StaffStepUpOptionsResponse.parse(await optionsRes.json());
      expect(options.rpId).toBe(TEST_CONSOLE_RP_ID);
      expect(options.allowCredentials).toEqual([{ id: s.credentialId, type: "public-key", transports: ["usb", "nfc"] }]);
      expect(options.userVerification).toBe("required");
      // What the console checks before it asks for the key: the layout, the purpose, and the binding of its own session's
      // handle and the hash of what it sent.
      const actionHash = await stepUpActionHash(request);
      const challenge = Buffer.from(options.challenge, "base64url");
      const L = STAFF_STEP_UP_CHALLENGE;
      expect(challenge).toHaveLength(L.bytes);
      expect(challenge[L.purposeAt]).toBe(L.purpose);
      expect(challenge.subarray(L.bindingAt, L.sealAt).equals(Buffer.from(await stepUpBinding(mine.handle, actionHash)))).toBe(true);

      const stepUp = await confirmation(s, target.handle, { counter: 3, challenge: options.challenge });
      const before = await head();
      clock.advance(MINUTE);
      const res = await revokeSession(s.b, target.handle, stepUp);
      expect(res.status, await res.clone().text()).toBe(204);
      expect(res.headers.getSetCookie()).toEqual([]);
      expect(accessControlHeaders(res)).toEqual([]);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toEqual(clock.now());
      const written = await migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, before.seq)).orderBy(asc(auditLog.chainSeq));
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.staffSession, r.keyId, r.actionHash, r.stepUp, r.metadata, r.requestId])).toEqual([
        [
          "staff_session_revoked",
          s.user.id,
          "staff_session",
          target.handle,
          mine.handle,
          s.keyId,
          actionHash,
          { authenticatorData: stepUp.response.authenticatorData, clientDataJSON: stepUp.response.clientDataJSON, signature: stepUp.response.signature },
          { params: {} },
          res.headers.get("x-request-id"),
        ],
      ]);
      await expectEnded(await other.fetch("/api/staff/me"), "the revoked session");
      expect((await s.b.fetch("/api/staff/me")).status).toBe(200);
      // The person may end the session they ask from as well; it ends at its next request.
      expect((await revokeSession(s.b, mine.handle, await confirmation(s, mine.handle, { counter: 4 }))).status).toBe(204);
      await expectEnded(await s.b.fetch("/api/staff/me"), "the session that revoked itself");
    });

    test("without a confirmation the answer is staff_step_up_required; a body, target or options request the schemas refuse is invalid_request; without the staff CSRF header, csrf_failed; nothing changes", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const before = await head();
      for (const [label, init] of [
        ["no body", { method: "DELETE" }],
        ["an empty body", { method: "DELETE", json: {} }],
      ] as const) {
        const res = await s.b.fetch(`/api/staff/sessions/${target.handle}`, init);
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "staff_step_up_required"]);
      }
      // Any assertion's shape will do for the schemas: the sign-in's is one.
      const shaped = s.first.response;
      for (const [label, path, body] of [
        ["a member the action's params do not take", `/api/staff/sessions/${target.handle}`, { all: true, stepUp: shaped }],
        ["a stepUp that is not an assertion", `/api/staff/sessions/${target.handle}`, { stepUp: { id: "x" } }],
        ["a handle that is not a uuid", "/api/staff/sessions/not-a-handle", { stepUp: shaped }],
      ] as const) {
        const res = await s.b.fetch(path, { method: "DELETE", json: body });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 400, "invalid_request"]);
      }
      for (const [label, body] of [
        ["an action no step-up confirms", { ...revokeRequest(target.handle), action: "role_granted" }],
        ["another target type", { ...revokeRequest(target.handle), target: { type: "user", id: target.handle } }],
        ["params the action does not take", { ...revokeRequest(target.handle), params: { all: true } }],
        ["a target that is not a uuid", revokeRequest("not-a-handle")],
      ] as const) {
        const res = await s.b.fetch("/api/staff/step-up/options", { json: body });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 400, "invalid_request"]);
      }
      // A write without the staff CSRF header is refused before the session is read, the options included.
      const stepUp = await confirmation(s, target.handle, { counter: 3 });
      expect((await s.b.fetch(`/api/staff/sessions/${target.handle}`, { method: "DELETE", json: { stepUp }, csrf: false })).status).toBe(403);
      expect((await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(target.handle), csrf: false })).status).toBe(403);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
      expect(await head()).toEqual(before);
      // The confirmation the refused write carried was never read, so it still confirms what it was given for.
      expect((await revokeSession(s.b, target.handle, stepUp)).status).toBe(204);
    });

    test("a spent challenge, one of another purpose, one with another binding and a bad signature are staff_step_up_invalid, never a passkey code; an expired one is challenge_expired", { timeout: 60_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const actionHash = await stepUpActionHash(revokeRequest(target.handle));
      const fresh = await confirmation(s, target.handle, { counter: 3 });
      const freshChallenge = JSON.parse(Buffer.from(fresh.response.clientDataJSON, "base64url").toString()).challenge as string;
      const signInChallenge = JSON.parse(Buffer.from(s.first.response.response.clientDataJSON, "base64url").toString()).challenge as string;
      const cases: [string, () => Promise<AuthenticationResponseJSON>][] = [
        // The library refuses it, after the challenge was spent: the same challenge signed well is then a spent one.
        ["a bad signature", async () => badSignature(fresh)],
        ["a spent step-up challenge", () => confirmation(s, target.handle, { counter: 4, challenge: freshChallenge })],
        ["the sign-in's challenge", () => confirmation(s, target.handle, { counter: 5, challenge: signInChallenge })],
        ["a staff sign-in challenge", () => confirmation(s, target.handle, { counter: 6, challenge: issueChallenge(key, "staff_signin", clock.now()) })],
        ["a re-authentication challenge for this session", () => confirmation(s, target.handle, { counter: 7, challenge: issueChallenge(key, "reauth", clock.now(), mine.handle) })],
        ["a step-up challenge for another session", () => confirmation(s, target.handle, { counter: 8, challenge: issueStepUpChallenge(key, clock.now(), target.handle, actionHash) })],
        [
          "a step-up challenge for another target",
          async () => confirmation(s, target.handle, { counter: 9, challenge: issueStepUpChallenge(key, clock.now(), mine.handle, await stepUpActionHash(revokeRequest(mine.handle))) }),
        ],
      ];
      for (const [label, make] of cases) {
        const res = await revokeSession(s.b, target.handle, await make());
        const { code } = await error(res);
        expect([label, res.status, code]).toEqual([label, 403, "staff_step_up_invalid"]);
        expect(code, label).not.toMatch(/^passkey_/);
      }
      const late = await confirmation(s, target.handle, { counter: 10 });
      clock.advance(10 * MINUTE);
      const expired = await revokeSession(s.b, target.handle, late);
      expect([expired.status, (await error(expired)).code]).toEqual([400, "challenge_expired"]);
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
    });

    test("another account's session is no session of the person's: 404, it lives on, and the confirmation is spent", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const t = await staffBrowser();
      const theirs = await sessionRow(t.token);
      const before = await head();
      const stepUp = await confirmation(s, theirs.handle, { counter: 3 });
      const res = await revokeSession(s.b, theirs.handle, stepUp);
      expect([res.status, (await error(res)).code]).toEqual([404, "not_found"]);
      expect((await sessionRow(t.token)).revokedAt).toBeNull();
      expect((await t.b.fetch("/api/staff/me")).status).toBe(200);
      expect(await head()).toEqual(before);
      const again = await revokeSession(s.b, theirs.handle, stepUp);
      expect([again.status, (await error(again)).code]).toEqual([403, "staff_step_up_invalid"]);
    });

    test("a handle in upper case is invalid_request, for the options and for the revocation even with a confirmation bound to that spelling: the id is hashed as sent but recorded as the database writes it, so only that spelling is taken", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const other = consoleBrowser();
      expect((await s.signIn(other)).res.status).toBe(200);
      const mine = await sessionRow(s.token);
      const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
      const upper = target.handle.toUpperCase();
      expect(upper).not.toBe(target.handle);
      const before = await head();
      const options = await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(upper), headers: MARKED });
      expect(options.status, await options.clone().text()).toBe(400);
      expect((await error(options)).code).toBe("invalid_request");
      // The challenge such options would have carried, bound to the upper-case spelling and signed by the session's key.
      const key = challengeKey(decodeKey(config.AUTH_HMAC_KEY));
      const bound = issueStepUpChallenge(key, clock.now(), mine.handle, await stepUpActionHash(revokeRequest(upper)));
      const res = await revokeSession(s.b, upper, await confirmation(s, upper, { counter: 3, challenge: bound }));
      expect(res.status, await res.clone().text()).toBe(400);
      expect((await error(res)).code).toBe("invalid_request");
      expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt).toBeNull();
      expect(await head()).toEqual(before);
      // The spelling the console reads from /sessions revokes it.
      expect((await revokeSession(s.b, target.handle, await confirmation(s, target.handle, { counter: 4 }))).status).toBe(204);
    });

    test("a session that ends inside the step-up is answered as requireStaff answers it, staff_session_required with both cookies cleared: its key revoked just before the options, or its key revoked or its account demoted between the confirmation and the action", { timeout: 60_000 }, async () => {
      type Staff = Awaited<ReturnType<typeof staffBrowser>>;
      const revokeKey = (s: Staff) => authDb.update(staffKeys).set({ revokedAt: clock.now() }).where(eq(staffKeys.id, s.keyId));
      const demote = (s: Staff) => authDb.update(users).set({ role: "user" }).where(eq(users.id, s.user.id));
      // Each change is made inside the request, after requireStaff read the session live: just before the options read
      // the session's key, or just before the revocation's transaction.
      const cases: [string, "findStaffKeyCredential" | "revokeConfirmedStaffSession", (s: Staff) => Promise<unknown>][] = [
        ["the key revoked before the options", "findStaffKeyCredential", revokeKey],
        ["the key revoked after the confirmation", "revokeConfirmedStaffSession", revokeKey],
        ["the account demoted after the confirmation", "revokeConfirmedStaffSession", demote],
      ];
      for (const [label, method, end] of cases) {
        const s = await staffBrowser();
        const other = consoleBrowser();
        expect((await s.signIn(other)).res.status, label).toBe(200);
        const target = await sessionRow(other.cookie(STAFF_COOKIE)!);
        const stepUp = method === "revokeConfirmedStaffSession" ? await confirmation(s, target.handle, { counter: 3 }) : undefined;
        const flows = auth.deps.repo;
        const original = flows[method].bind(flows) as (...args: unknown[]) => Promise<unknown>;
        const spy = vi.spyOn(flows, method).mockImplementationOnce((async (...args: unknown[]) => {
          await end(s);
          return original(...args);
        }) as never);
        try {
          const res = stepUp
            ? await revokeSession(s.b, target.handle, stepUp)
            : await s.b.fetch("/api/staff/step-up/options", { json: revokeRequest(target.handle), headers: MARKED });
          expect(spy, label).toHaveBeenCalledOnce();
          await expectEnded(res, label);
        } finally {
          spy.mockRestore();
        }
        expect(s.b.cookie(STAFF_COOKIE), label).toBeUndefined();
        expect(s.b.cookie(STAFF_CSRF_COOKIE), label).toBeUndefined();
        expect((await sessionRow(other.cookie(STAFF_COOKIE)!)).revokedAt, label).toBeNull();
      }
    });
  });

  describe("what opens a staff route", () => {
    test("the staff cookie only: the app's session cookie and a bearer token are refused, a staff cookie opens no app route, and a session created after now is refused", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const app_ = await auth.deps.sessions.issue(s.user.id, s.device.id, { factors: { email: clock.ms() } });
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `__Host-korbat_session=${app_.token}` } }), "the app's session cookie");
      await expectEnded(await raw("/api/staff/me", { headers: { authorization: `Bearer ${app_.token}` } }), "a bearer token");
      await expectEnded(await raw("/api/staff/me", { headers: { authorization: `Bearer ${s.token}` } }), "the staff token as a bearer token");
      // The staff cookie under the app's name, and on the app's host, opens nothing there.
      const onApp = await app.request("/api/me", { headers: { cookie: `${STAFF_COOKIE}=${s.token}`, "cf-connecting-ip": randomIp() } });
      expect(onApp.status).toBe(401);
      expect((await error(onApp)).code).toBe("unauthenticated");
      const asApp = await app.request("/api/me", { headers: { cookie: `__Host-korbat_session=${s.token}`, "cf-connecting-ip": randomIp() } });
      expect(asApp.status).toBe(401);

      // A row written behind the flows' back that starts in the future, within the database's 12 hours.
      const token = randomToken();
      const start = new Date(clock.ms() + HOUR);
      await authDb.insert(staffSessions).values({
        id: sha256Hex(token),
        userId: s.user.id,
        keyId: s.keyId,
        createdAt: start,
        lastUsedAt: start,
        idleExpiresAt: new Date(start.getTime() + 15 * MINUTE),
        absoluteExpiresAt: new Date(start.getTime() + 12 * HOUR),
        browser: "Firefox on Linux",
      });
      await expectEnded(await raw("/api/staff/me", { headers: { cookie: `${STAFF_COOKIE}=${token}` } }), "a session created after now");
    });

    test("CSRF: a write needs x-staff-csrf equal to the staff CSRF cookie; the app's CSRF cookie and header do not count, and a refused write touches nothing", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const csrf = s.b.cookie(STAFF_CSRF_COOKIE)!;
      const before = await sessionRow(s.token);
      clock.advance(MINUTE);
      const post = (headers: Record<string, string>) => raw("/api/staff/signout", { method: "POST", headers: { origin: TEST_CONSOLE_ORIGIN, ...MARKED, ...headers } });
      const cases: [string, Record<string, string>][] = [
        ["no header", { cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}` }],
        ["another value", { cookie: `${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}`, "x-staff-csrf": `${csrf.slice(1)}A` }],
        ["the header without its cookie", { cookie: `${STAFF_COOKIE}=${s.token}`, "x-staff-csrf": csrf }],
        ["the app's CSRF cookie and header", { cookie: `${STAFF_COOKIE}=${s.token}; __Host-korbat_csrf=${csrf}`, "x-csrf-token": csrf }],
      ];
      for (const [label, headers] of cases) {
        const res = await post(headers);
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "csrf_failed"]);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect((await s.b.fetch("/api/staff/signout", { method: "POST", csrf: false })).status).toBe(403);
      expect(await sessionRow(s.token)).toEqual(before);
      expect((await s.b.fetch("/api/staff/signout", { method: "POST" })).status).toBe(204);
    });
  });

  describe("the staff gate over HTTP", () => {
    test("a console POST sent with the app's session and CSRF cookies present reaches its route and is not csrf_failed", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const app_ = await auth.deps.sessions.issue(s.user.id, s.device.id, { factors: { email: clock.ms() } });
      const csrf = s.b.cookie(STAFF_CSRF_COOKIE)!;
      const res = await raw("/api/staff/signout", {
        method: "POST",
        headers: {
          origin: TEST_CONSOLE_ORIGIN,
          "sec-fetch-site": "same-origin",
          cookie: `__Host-korbat_session=${app_.token}; __Host-korbat_csrf=app-csrf; ${STAFF_COOKIE}=${s.token}; ${STAFF_CSRF_COOKIE}=${csrf}`,
          "x-csrf-token": "app-csrf",
          "x-staff-csrf": csrf,
        },
      });
      expect(res.status, await res.clone().text()).toBe(204);
      expect((await sessionRow(s.token)).revokedAt).not.toBeNull();
      // The app's session was neither read nor ended.
      expect(await repo.findActiveSession(app_.session.sessionId, clock.now())).toBeDefined();
    });

    test("no answer under /api/staff/ carries an Access-Control-* header, even to an Origin the app trusts", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const trusted = config.TRUSTED_ORIGINS[0]!;
      const cookie = `${STAFF_COOKIE}=${s.token}`;
      for (const [label, path, init] of [
        ["a read with the trusted Origin", "/api/staff/me", { headers: { cookie, origin: trusted } }],
        ["a preflight from the trusted Origin", "/api/staff/signout", { method: "OPTIONS", headers: { origin: trusted, "access-control-request-method": "POST" } }],
        ["a read of the audit log", "/api/staff/audit", { headers: { cookie } }],
        ["a read with the console's Origin", "/api/staff/sessions", { headers: { cookie, origin: TEST_CONSOLE_ORIGIN } }],
        ["the sign-in options", "/api/staff/signin/options", { method: "POST", headers: { origin: trusted } }],
      ] as const) {
        const res = await raw(path, init);
        expect(accessControlHeaders(res), label).toEqual([]);
      }
      expect(accessControlHeaders(s.first.res)).toEqual([]);
    });

    test("Sec-Fetch-Site other than same-origin, or another Origin, is refused and leaves the idle end and the last use unchanged; another Host is the unknown route", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const before = await sessionRow(s.token);
      clock.advance(5 * MINUTE);
      const cookie = `${STAFF_COOKIE}=${s.token}`;
      for (const [label, headers] of [
        ["same-site", { "sec-fetch-site": "same-site" }],
        ["cross-site", { "sec-fetch-site": "cross-site" }],
        ["the app's Origin", { origin: "http://localhost:8081" }],
        ["another localhost port", { origin: "http://localhost:8090" }],
      ] as const) {
        const res = await raw("/api/staff/me", { headers: { cookie, ...MARKED, ...headers } });
        expect([label, res.status, (await error(res)).code]).toEqual([label, 403, "csrf_failed"]);
        expect(res.headers.getSetCookie(), label).toEqual([]);
      }
      expect(await sessionRow(s.token)).toEqual(before);
      // Another Host, the console's cookie and mark notwithstanding: the 404 of an unknown route, the session untouched.
      for (const host of ["localhost:8080", "console.localhost", "localhost:8090"]) {
        const res = await app.request(`http://${host}/api/staff/me`, { headers: { host, cookie, ...MARKED, "cf-connecting-ip": randomIp() } });
        expect([host, res.status, (await error(res)).code]).toEqual([host, 404, "not_found"]);
      }
      expect(await sessionRow(s.token)).toEqual(before);
    });
  });

  describe("the audit log", () => {
    test("newest first by place, the sign-in's row naming its actor by handle; the staff_sign_in filter, cursor pages and ?at=; reading writes nothing", { timeout: 30_000 }, async () => {
      const s = await staffBrowser();
      const [signInRow] = await migrateDb
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "staff_sign_in"), eq(auditLog.actorId, s.user.id)));
      const before = await head();

      const page = AuditPage.parse(await (await s.b.fetch("/api/staff/audit")).json());
      expect(page.entries[0]!.seq).toBe(before.seq);
      expect(page.entries.map((e) => e.seq)).toEqual([...page.entries.map((e) => e.seq)].sort((a, b) => b - a));
      const mine = page.entries.find((e) => e.seq === signInRow!.chainSeq)!;
      expect(mine).toEqual({
        seq: signInRow!.chainSeq,
        hash: signInRow!.hash,
        createdAt: signInRow!.createdAt.toISOString(),
        actorHandle: s.handle,
        action: "staff_sign_in",
        targetType: "staff_session",
        targetId: signInRow!.targetId,
        actionHash: null,
      });

      const signIns = AuditPage.parse(await (await s.b.fetch("/api/staff/audit?action=staff_sign_in")).json());
      expect(signIns.entries.every((e) => e.action === "staff_sign_in")).toBe(true);
      expect(signIns.entries[0]!.seq).toBe(signInRow!.chainSeq);

      const at = AuditPage.parse(await (await s.b.fetch(`/api/staff/audit?at=${signInRow!.chainSeq}`)).json());
      expect(at.entries[0]!.seq).toBe(signInRow!.chainSeq);
      const older = AuditPage.parse(await (await s.b.fetch(`/api/staff/audit?cursor=${signInRow!.chainSeq}`)).json());
      expect(older.entries.every((e) => e.seq < signInRow!.chainSeq)).toBe(true);

      for (const query of ["?at=0", "?cursor=2&at=2", "?action=role_granted", "?cursor=abc"]) {
        const res = await s.b.fetch(`/api/staff/audit${query}`);
        expect([query, res.status, (await error(res)).code]).toEqual([query, 400, "invalid_request"]);
      }
      expect(await head()).toEqual(before);
      await expectEnded(await raw("/api/staff/audit"), "without a session");
    });
  });
});
```

### Replace `apps/api/test/integration/staff-lifecycle.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditHead, auditLog, authEvents, closeDb, createDb, staffEnrollments, staffKeys, staffSessions, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { confirmDeletion, startDeletion } from "../../src/auth/flows/deletion";
import { MemoryKv } from "../../src/auth/kv";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { createSessions } from "../../src/auth/sessions";
import { enrollOptions, enrollVerify } from "../../src/auth/staff/enroll";
import { SYSTEM_ACTOR_ID, runGrantRole } from "../../src/cli/grant-role";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createProfileStore } from "../../src/profiles/store";
import { SoftAuthenticator } from "../auth/soft-authenticator";
import { flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { DEVICE_BOUND, TEST_CONSOLE, TEST_CONSOLE_ORIGIN, addStaffKey, issueEnrolment, newStaffAccount, newStaffSession, withLockTimeout } from "./staff-fixtures";

/** A time as the staff mails print it, as 1c's mails do: the date and the minute in UTC. */
const mailTime = (at: Date) => `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)} UTC`;

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/**
 * What happens to an account's staff keys, staff sessions and enrolments when its role changes or the account is taken
 * down (3a design, section 7, Role changes, deletion and retention), on the real database: every change and its auth
 * events in one transaction on the auth role, with the audit rows last, and the staff mails where section 7 says.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff rows through role changes and account deletion", () => {
  let apiDb: Db;
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    // The migrate role issues enrolments and reads every row back; the test environment carries its URL.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(apiDb), closeDb(authDb), closeDb(migrateDb)]);
  });

  const head = async () => (await migrateDb.select().from(auditHead))[0]!;
  const keysOf = (userId: string) => migrateDb.select().from(staffKeys).where(eq(staffKeys.userId, userId)).orderBy(asc(staffKeys.createdAt));
  const sessionsOf = (userId: string) => migrateDb.select().from(staffSessions).where(eq(staffSessions.userId, userId));
  const enrolmentsOf = (userId: string) => migrateDb.select().from(staffEnrollments).where(eq(staffEnrollments.userId, userId));
  const revokedEvents = (userId: string) =>
    migrateDb
      .select({ metadata: authEvents.metadata })
      .from(authEvents)
      .where(and(eq(authEvents.userId, userId), eq(authEvents.type, "staff_key_revoked")))
      .orderBy(asc(authEvents.id));
  /** The rows written after place `seq`, in chain order. */
  const rowsAfter = (seq: number) => migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, seq)).orderBy(asc(auditLog.chainSeq));
  const xminOf = async (table: string, ids: string[]) =>
    (await migrateDb.execute<{ xmin: string }>(sql`select xmin::text as xmin from ${sql.raw(table)} where id::text in ${ids}`)).map((row) => row.xmin);
  /**
   * The command id (cmin) of the statement that wrote each row the query selects. One transaction numbers its statements in
   * the order they ran, so rows that share an xmin can be ordered by it from outside. Every row read here is the version
   * its transaction wrote last, never changed again in it, so the column holds that statement's own number rather than
   * the combined one PostgreSQL keeps for a version a transaction both wrote and replaced.
   */
  const cmins = async (query: SQL) => (await migrateDb.execute<{ cmin: string }>(query)).map((row) => Number(row.cmin));
  const eventCmins = (userId: string, type: string) => cmins(sql`select cmin::text as cmin from auth.auth_events where user_id = ${userId} and type = ${type}`);
  const auditCmins = (ids: string[]) => cmins(sql`select cmin::text as cmin from public.audit_log where id::text in ${ids}`);
  /** The statement that last wrote the account's staff keys: the take-down's blanking, the last statement of takeDownRows. */
  const keyCmins = (userId: string) => cmins(sql`select cmin::text as cmin from auth.staff_keys where user_id = ${userId}`);

  /**
   * A staff account holding two live keys (Blue, then Red) and one revoked a minute ago (Old), with two live staff sessions
   * on Blue and one on Red, the three spent enrolments of its keys and one open enrolment link.
   */
  async function staffWithRows(userId: string) {
    const enrol = async (name: string) => addStaffKey(authDb, (await issueEnrolment(migrateDb, userId)).token, { name });
    const blue = await enrol("Blue key");
    const red = await enrol("Red key");
    const old = await enrol("Old key");
    const oldRevokedAt = new Date(Date.now() - 60_000);
    await authDb.update(staffKeys).set({ revokedAt: oldRevokedAt }).where(eq(staffKeys.id, old.id));
    const sessions = [await newStaffSession(authDb, userId, blue.id), await newStaffSession(authDb, userId, blue.id), await newStaffSession(authDb, userId, red.id)];
    const open = await issueEnrolment(migrateDb, userId);
    return { blue, red, old, oldRevokedAt, sessions, open };
  }

  describe("grant-role", () => {
    test("to user: every staff key and staff session revoked and every unused enrolment deleted, each key's revocation recorded before the role change, in one transaction, then the owner mailed", { timeout: 30_000 }, async () => {
      const { user } = await newStaffAccount(authDb, repo, "moderator");
      const rows = await staffWithRows(user.id);
      const mailer = new MemoryMailer();
      const before = await head();

      const result = await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, user.email, "user");
      expect(result).toEqual({ userId: user.id, previousRole: "moderator", staffSessionsRevoked: 3, enrollmentsDeleted: 1, staffKeysRevoked: 2, mailError: null, tombstoneError: null });

      // The two live keys are revoked at the change's time, never suspect; the old one keeps the time it was revoked at.
      const keys = await keysOf(user.id);
      const revokedAt = keys[0]!.revokedAt!;
      expect(keys.map((k) => [k.name, k.revokedAt, k.suspectAt])).toEqual([
        ["Blue key", revokedAt, null],
        ["Red key", revokedAt, null],
        ["Old key", rows.oldRevokedAt, null],
      ]);
      expect((await sessionsOf(user.id)).every((s) => s.revokedAt !== null)).toBe(true);
      // The spent enrolments stay for the janitor; the open link is gone.
      const enrolments = await enrolmentsOf(user.id);
      expect(enrolments).toHaveLength(3);
      expect(enrolments.every((e) => e.usedAt !== null)).toBe(true);

      expect((await revokedEvents(user.id)).map((e) => e.metadata)).toEqual([
        { keyId: rows.blue.id, sessionsRevoked: 2, via: "role_change" },
        { keyId: rows.red.id, sessionsRevoked: 1, via: "role_change" },
      ]);
      // Each revocation's row, then the role change's, last, all from the command line.
      const written = await rowsAfter(before.seq);
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.metadata])).toEqual([
        ["staff_key_revoked", SYSTEM_ACTOR_ID, "staff_key", rows.blue.id, { keyId: rows.blue.id, sessionsRevoked: 2, via: "role_change" }],
        ["staff_key_revoked", SYSTEM_ACTOR_ID, "staff_key", rows.red.id, { keyId: rows.red.id, sessionsRevoked: 1, via: "role_change" }],
        ["role_granted", SYSTEM_ACTOR_ID, "user", user.id, { from: "moderator", to: "user", via: "cli", staffSessionsRevoked: 3, enrollmentsDeleted: 1 }],
      ]);
      // One transaction: the account's row, the keys, the sessions and the audit rows carry one transaction id.
      const xmins = new Set([
        ...(await xminOf("auth.users", [user.id])),
        ...(await xminOf("auth.staff_keys", [rows.blue.id, rows.red.id])),
        ...(await xminOf("auth.staff_sessions", rows.sessions.map((s) => s.id))),
        ...(await xminOf("public.audit_log", written.map((r) => String(r.id)))),
      ]);
      expect(xmins.size).toBe(1);

      // After the commit, the owner learns which keys went and when; no link.
      expect(mailer.sent).toEqual([{ to: user.email, template: "staff_keys_revoked", data: { names: '"Blue key", "Red key"', time: mailTime(revokedAt) } }]);
    });

    test("back to staff revives no key; and between moderator and admin the staff sessions and open links end while the keys stay, with no mail", { timeout: 30_000 }, async () => {
      const { user } = await newStaffAccount(authDb, repo, "moderator");
      const mailer = new MemoryMailer();
      await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, user.email, "user");
      await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, user.email, "admin");
      expect(await keysOf(user.id)).toEqual([]);

      const rows = await staffWithRows(user.id);
      const before = await head();
      const result = await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, user.email, "moderator");
      expect(result).toEqual({ userId: user.id, previousRole: "admin", staffSessionsRevoked: 3, enrollmentsDeleted: 1, staffKeysRevoked: 0, mailError: null, tombstoneError: null });
      const keys = await keysOf(user.id);
      expect(keys.map((k) => [k.name, k.revokedAt])).toEqual([
        ["Blue key", null],
        ["Red key", null],
        ["Old key", rows.oldRevokedAt],
      ]);
      expect((await sessionsOf(user.id)).every((s) => s.revokedAt !== null)).toBe(true);
      expect((await enrolmentsOf(user.id)).map((e) => e.id)).not.toContain(rows.open.id);
      expect(await revokedEvents(user.id)).toEqual([]);
      const written = await rowsAfter(before.seq);
      expect(written.map((r) => [r.action, r.metadata])).toEqual([["role_granted", { from: "admin", to: "moderator", via: "cli", staffSessionsRevoked: 3, enrollmentsDeleted: 1 }]]);
      // Demoting an account that holds no live key mails nothing, and nor does this change.
      expect(mailer.sent).toEqual([]);

      // Made a user again, then staff again: the keys revoked on the way stay revoked.
      await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, user.email, "user");
      await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, user.email, "moderator");
      expect((await keysOf(user.id)).every((k) => k.revokedAt !== null)).toBe(true);
      expect(mailer.sent.map((m) => m.template)).toEqual(["staff_keys_revoked"]);
    });

    test("a sign-in that holds its key while a demotion waits for it: the session it opens is found and revoked by the demotion, and counted on the record", { timeout: 30_000 }, async () => {
      // A sign-in's transaction records the key's use (holding the key's row) and inserts its session, which needs only a
      // FOR KEY SHARE lock on the account's row, so the demotion's FOR NO KEY UPDATE does not wait for it. The demotion then
      // waits for the key's row; once the sign-in commits, its session must be among those the demotion revokes.
      const { user } = await newStaffAccount(authDb, repo, "moderator");
      const key = await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token, { name: "Blue key" });
      const before = await head();
      let demotion: Promise<Awaited<ReturnType<typeof runGrantRole>>> | undefined;
      let opened: { id: string; handle: string } | undefined;
      await withLockTimeout(authDb, async (tx) => {
        await tx.update(staffKeys).set({ counter: 1, lastUsedAt: new Date() }).where(eq(staffKeys.id, key.id));
        const now = new Date();
        [opened] = await tx
          .insert(staffSessions)
          .values({
            id: sha256Hex(randomToken()),
            userId: user.id,
            keyId: key.id,
            createdAt: now,
            lastUsedAt: now,
            idleExpiresAt: new Date(now.getTime() + 15 * 60_000),
            absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60_000),
            browser: "Firefox on Linux",
          })
          .returning({ id: staffSessions.id, handle: staffSessions.handle });
        demotion = runGrantRole({ authDb, kv: new MemoryKv(), mailer: new MemoryMailer() }, user.email, "user");
        // Commit only once the demotion waits for a lock: the key's row this transaction holds. Read on a connection of
        // its own, outside this transaction, whose view of the server's activity would not move.
        for (let tries = 0; ; tries++) {
          const [waiting] = await authDb.execute<{ n: number }>(sql`select count(*)::int as n from pg_stat_activity where usename = current_user and wait_event_type = 'Lock'`);
          if (waiting!.n > 0) break;
          if (tries > 200) throw new Error("the demotion never waited for the key's row");
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      });
      const result = await demotion!;
      expect(result).toMatchObject({ staffSessionsRevoked: 1, staffKeysRevoked: 1 });
      expect((await sessionsOf(user.id)).map((s) => [s.handle, s.revokedAt !== null])).toEqual([[opened!.handle, true]]);
      const written = await rowsAfter(before.seq);
      expect(written.map((r) => [r.action, r.metadata])).toEqual([
        ["staff_key_revoked", { keyId: key.id, sessionsRevoked: 1, via: "role_change" }],
        ["role_granted", { from: "moderator", to: "user", via: "cli", staffSessionsRevoked: 1, enrollmentsDeleted: 0 }],
      ]);
    });

    test("Valkey unreachable after the commit: the tombstones fail, the owner is still mailed, both steps are reported, and the change stands", { timeout: 30_000 }, async () => {
      const { user, device } = await newStaffAccount(authDb, repo, "moderator");
      await staffWithRows(user.id);
      // An app session for the demotion to revoke, so its tombstone is due.
      await createSessions({ repo, kv: new MemoryKv() }).issue(user.id, device.id, { factors: { email: Date.now() } });
      const kv = new MemoryKv();
      kv.set = async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:6379");
      };
      const mailer = new MemoryMailer();
      const result = await runGrantRole({ authDb, kv, mailer }, user.email, "user");
      expect(result).toMatchObject({ staffKeysRevoked: 2, mailError: null, tombstoneError: expect.stringMatching(/ECONNREFUSED/) });
      expect(mailer.sent.map((m) => [m.to, m.template])).toEqual([[user.email, "staff_keys_revoked"]]);
      expect((await repo.findUserById(user.id))!.role).toBe("user");
      expect((await keysOf(user.id)).every((k) => k.revokedAt !== null)).toBe(true);
    });

    test("a mail that fails is reported and undoes nothing", { timeout: 30_000 }, async () => {
      const { user } = await newStaffAccount(authDb, repo, "admin");
      await staffWithRows(user.id);
      const mailer = new MemoryMailer();
      mailer.failing = true;
      const result = await runGrantRole({ authDb, kv: new MemoryKv(), mailer }, user.email, "user");
      expect(result).toMatchObject({ staffKeysRevoked: 2, mailError: expect.stringMatching(/fail/) });
      expect((await keysOf(user.id)).every((k) => k.revokedAt !== null)).toBe(true);
      expect((await repo.findUserById(user.id))!.role).toBe("user");
    });

    test("a link issued before a role change enrols nothing, even once the account is staff again", { timeout: 30_000 }, async () => {
      const h = flowHarness(repo, { console: TEST_CONSOLE });
      for (const [from, through, to] of [
        ["moderator", "user", "moderator"],
        ["moderator", "admin", "admin"],
      ] as const) {
        const { user } = await newStaffAccount(authDb, repo, from);
        const enrolment = await issueEnrolment(migrateDb, user.id);
        const { options } = await enrollOptions(h.deps, { token: enrolment.token, name: "Blue key", kind: "security_key" });
        const response = new SoftAuthenticator().create({
          rpId: options.rp.id!,
          challenge: options.challenge,
          origin: TEST_CONSOLE_ORIGIN,
          userHandle: Buffer.from(options.user.id, "base64url"),
          flags: DEVICE_BOUND,
        });
        await runGrantRole({ authDb, kv: new MemoryKv(), mailer: new MemoryMailer() }, user.email, through);
        if (to !== through) await runGrantRole({ authDb, kv: new MemoryKv(), mailer: new MemoryMailer() }, user.email, to);
        const err = await failure(enrollVerify(h.deps, { token: enrolment.token, name: "Blue key", response }, { ...h.ctx, requestId: `req-${randomUUID()}` }));
        expect([from, through, err.code]).toEqual([from, through, "staff_enrollment_invalid"]);
        expect(await keysOf(user.id)).toEqual([]);
      }
    });
  });

  describe("the account's take-down", () => {
    /** An onboarded account with a profile, made staff, through the deletion flow's own harness. */
    async function staffOwner(h: FlowHarness) {
      const owner = await onboardedUser(h, repo);
      const handle = `t_${randomUUID().slice(0, 8)}`;
      expect((await createProfileStore(apiDb).create({ id: owner.user.id, handle, displayName: "Owner" })).ok).toBe(true);
      await authDb.execute(sql`update auth.users set role = 'moderator' where id = ${owner.user.id}`);
      return { ...owner, handle };
    }

    test("revokes the staff keys and sessions, deletes the enrolments and blanks the keys in the take-down's transaction, records them after account_deleted, and mails only account_deleted", { timeout: 30_000 }, async () => {
      const h = flowHarness(repo, { profiles: createProfileStore(apiDb), console: TEST_CONSOLE });
      const owner = await staffOwner(h);
      const rows = await staffWithRows(owner.user.id);
      // A ceremony begun on the open link before the deletion.
      const { options } = await enrollOptions(h.deps, { token: rows.open.token, name: "Late key", kind: "this_device" });
      const late = new SoftAuthenticator().create({
        rpId: options.rp.id!,
        challenge: options.challenge,
        origin: TEST_CONSOLE_ORIGIN,
        userHandle: Buffer.from(options.user.id, "base64url"),
        flags: DEVICE_BOUND,
      });
      const { flowId } = await startDeletion(h.deps, owner.session, h.ctx);
      const code = h.mailer.lastCodeFor(owner.email)!;
      const before = await head();

      await confirmDeletion(h.deps, owner.session, { flowId, code, handle: owner.handle });

      // Every key revoked (the old one keeps its time), none left with a name, an AAGUID or transports, and every key
      // still there with what audit-verify needs.
      const keys = await keysOf(owner.user.id);
      expect(keys.map((k) => k.id)).toEqual([rows.blue.id, rows.red.id, rows.old.id]);
      expect(keys.map((k) => [k.name, k.aaguid, k.transports, k.revokedAt === null, k.suspectAt])).toEqual([
        ["", null, [], false, null],
        ["", null, [], false, null],
        ["", null, [], false, null],
      ]);
      expect(keys[2]!.revokedAt).toEqual(rows.oldRevokedAt);
      expect(keys.every((k) => k.publicKey === "cose-key" && k.origin === TEST_CONSOLE_ORIGIN)).toBe(true);
      expect((await sessionsOf(owner.user.id)).every((s) => s.revokedAt !== null)).toBe(true);
      expect(await enrolmentsOf(owner.user.id)).toEqual([]);
      expect((await revokedEvents(owner.user.id)).map((e) => e.metadata)).toEqual([
        { keyId: rows.blue.id, sessionsRevoked: 2, via: "take_down" },
        { keyId: rows.red.id, sessionsRevoked: 1, via: "take_down" },
      ]);

      // The audit rows of the person's own deletion: each key's revocation, then the one open link cancelled. The three spent
      // links went too, but they could enrol nothing, so cancelling is not what happened to them.
      const written = await rowsAfter(before.seq);
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.metadata])).toEqual([
        ["staff_key_revoked", owner.user.id, "staff_key", rows.blue.id, { keyId: rows.blue.id, sessionsRevoked: 2, via: "take_down" }],
        ["staff_key_revoked", owner.user.id, "staff_key", rows.red.id, { keyId: rows.red.id, sessionsRevoked: 1, via: "take_down" }],
        ["staff_enrollments_cancelled", owner.user.id, "user", owner.user.id, { count: 1, via: "take_down" }],
      ]);
      const xmins = new Set([
        ...(await xminOf("auth.users", [owner.user.id])),
        ...(await xminOf("auth.staff_keys", keys.map((k) => k.id))),
        ...(await xminOf("auth.staff_sessions", rows.sessions.map((s) => s.id))),
        ...(
          await migrateDb.execute<{ xmin: string }>(sql`select xmin::text as xmin from auth.auth_events where user_id = ${owner.user.id} and type in ('account_deleted', 'staff_key_revoked')`)
        ).map((row) => row.xmin),
        ...(await xminOf("public.audit_log", written.map((r) => String(r.id)))),
      ]);
      expect(xmins.size).toBe(1);
      // And in that transaction the audit rows come after account_deleted, as its last statements.
      const [deletedCmin] = await eventCmins(owner.user.id, "account_deleted");
      expect(Math.min(...(await auditCmins(written.map((r) => String(r.id)))))).toBeGreaterThan(deletedCmin!);

      // The ceremony begun before enrols nothing, and the account's only mails are its deletion's.
      const err = await failure(enrollVerify(h.deps, { token: rows.open.token, name: "Late key", response: late }, { ...h.ctx, requestId: `req-${randomUUID()}` }));
      expect(err.code).toBe("staff_enrollment_invalid");
      expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code", "account_deleted"]);
    });

    test("the purge's finishTakeDown does the same for an account marked deleted, as the server, and a second run writes nothing", { timeout: 30_000 }, async () => {
      const { user } = await newStaffAccount(authDb, repo, "admin");
      const rows = await staffWithRows(user.id);
      await repo.markDeleted(user.id, new Date());
      const before = await head();

      await repo.finishTakeDown(user.id, new Date());

      expect((await keysOf(user.id)).map((k) => [k.name, k.revokedAt === null])).toEqual([
        ["", false],
        ["", false],
        ["", false],
      ]);
      expect((await sessionsOf(user.id)).every((s) => s.revokedAt !== null)).toBe(true);
      expect(await enrolmentsOf(user.id)).toEqual([]);
      const written = await rowsAfter(before.seq);
      expect(written.map((r) => [r.action, r.actorId, r.targetId, r.metadata])).toEqual([
        ["staff_key_revoked", SYSTEM_ACTOR_ID, rows.blue.id, { keyId: rows.blue.id, sessionsRevoked: 2, via: "take_down" }],
        ["staff_key_revoked", SYSTEM_ACTOR_ID, rows.red.id, { keyId: rows.red.id, sessionsRevoked: 1, via: "take_down" }],
        ["staff_enrollments_cancelled", SYSTEM_ACTOR_ID, user.id, { count: 1, via: "take_down" }],
      ]);
      // The audit rows come after every statement of takeDownRows: its staff_key_revoked events and, last, the keys' blanking.
      const takenCmins = [...(await eventCmins(user.id, "staff_key_revoked")), ...(await keyCmins(user.id))];
      expect(Math.min(...(await auditCmins(written.map((r) => String(r.id)))))).toBeGreaterThan(Math.max(...takenCmins));

      const after = await head();
      await repo.finishTakeDown(user.id, new Date());
      expect(await head()).toEqual(after);
      expect(await revokedEvents(user.id)).toHaveLength(2);
      expect(await migrateDb.select().from(auditLog).where(inArray(auditLog.targetId, [rows.blue.id, rows.red.id]))).toHaveLength(4);
    });

    test("spent links go with the take-down without counting as cancelled: with no open link, no staff_enrollments_cancelled row", { timeout: 30_000 }, async () => {
      const { user } = await newStaffAccount(authDb, repo, "moderator");
      const key = await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token, { name: "Blue key" });
      const before = await head();

      await repo.takeDown(user.id, new Date(), null);

      // The key's spent enrolment is gone with the account's other rows, and the record names only the key's revocation.
      expect(await enrolmentsOf(user.id)).toEqual([]);
      const written = await rowsAfter(before.seq);
      expect(written.map((r) => [r.action, r.actorId, r.targetId, r.metadata])).toEqual([
        ["staff_key_revoked", user.id, key.id, { keyId: key.id, sessionsRevoked: 0, via: "take_down" }],
      ]);
    });
  });
});
```

### Replace `apps/api/test/integration/staff-schema.test.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { auditHead, auditLog, closeDb, createDb, staffEnrollments, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import {
  TEST_CONSOLE_ORIGIN,
  TEST_CONSOLE_RP_ID,
  addStaffKey,
  issueEnrolment,
  newStaffAccount,
  newStaffKey,
  pgError,
  rolledBack,
  withLockTimeout,
} from "./staff-fixtures";

const HOUR = 60 * 60_000;

/** The auth side's actions, the only ones auth.append_audit writes (3a design, section 6). */
const AUTH_SIDE_ACTIONS = [
  "staff_key_revoked",
  "staff_key_counter_regression",
  "staff_sign_in",
  "staff_signed_out",
  "staff_session_revoked",
  "staff_enrollments_cancelled",
  "role_granted",
];

/**
 * Migration 0012's staff tables and functions (3a design, section 6) against the real database, before any flow uses them.
 * Statements run as korbat_auth, the role the running API holds, unless a test says otherwise: what it cannot do is what a
 * compromised API cannot do. Keys are made only through auth.add_staff_key, from enrolments the migrator inserts, as
 * `staff.js enroll` will.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the staff tables and functions", () => {
  let authDb: Db;
  let apiDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    const config = loadConfig();
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    apiDb = createDb(config.DATABASE_URL_API, { max: 2 });
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    repo = createAuthRepo(authDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(apiDb), closeDb(migrateDb)]);
  });

  const keyRow = async (id: string) => (await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, id)))[0]!;
  const enrolmentRow = async (id: string) => (await migrateDb.select().from(staffEnrollments).where(eq(staffEnrollments.id, id)))[0]!;
  const keysOf = (userId: string) => migrateDb.$count(staffKeys, eq(staffKeys.userId, userId));
  const head = async () => (await apiDb.select().from(auditHead))[0]!;
  /** Runs one statement as the auth role, in a transaction with a lock timeout, and returns its error or null. */
  const asAuth = (statement: ReturnType<typeof sql>) => pgError(withLockTimeout(authDb, (tx) => tx.execute(statement)));

  describe("auth.add_staff_key", () => {
    test("spends a live enrolment of a live staff account with a handle, stores the key with the enrolment's origin and relying party ID, and writes its audit row", async () => {
      const { user } = await newStaffAccount(authDb, repo, "admin");
      const enrolment = await issueEnrolment(migrateDb, user.id, { origin: "http://localhost:8090", rpId: "localhost" });
      const key = await addStaffKey(authDb, enrolment.token, { transports: ["internal", "hybrid"], name: "Windows Hello", counter: 3 });

      expect(key.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await keyRow(key.id)).toMatchObject({
        userId: user.id,
        credentialId: key.credentialId,
        publicKey: key.publicKey,
        counter: 3,
        transports: ["internal", "hybrid"],
        name: "Windows Hello",
        aaguid: key.aaguid,
        origin: "http://localhost:8090",
        rpId: "localhost",
        lastUsedAt: null,
        revokedAt: null,
        suspectAt: null,
      });
      expect((await enrolmentRow(enrolment.id)).usedAt).toBeInstanceOf(Date);

      // Its audit row is the newest row of the chain: the function's last statement.
      const rows = await apiDb.select().from(auditLog).where(eq(auditLog.keyId, key.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: user.id,
        action: "staff_key_added",
        targetType: "staff_key",
        targetId: key.id,
        keyId: key.id,
        requestId: key.requestId,
        metadata: { enrollmentId: enrolment.id },
        staffSession: null,
        actionHash: null,
        stepUp: null,
        chainVersion: 1,
      });
      expect(await head()).toMatchObject({ seq: rows[0]!.chainSeq, hash: rows[0]!.hash });
    });

    test("refuses an unknown token, a token hash given in place of the token, a spent token and an expired one", async () => {
      const { user } = await newStaffAccount(authDb, repo);
      const live = await issueEnrolment(migrateDb, user.id);
      // Expired ten minutes ago by Node's clock, so no gap between Node's clock and the database's, which the function
      // reads, can make it live again.
      const expired = await issueEnrolment(migrateDb, user.id, { expiresAt: new Date(Date.now() - 10 * 60_000) });
      const spent = await issueEnrolment(migrateDb, user.id);
      await addStaffKey(authDb, spent.token);
      const before = { keys: await keysOf(user.id), head: await head() };

      // The stored hash is hashed again by the function, so reading the table spends nothing.
      for (const token of [randomToken(), sha256Hex(live.token), spent.token, expired.token]) {
        const err = await pgError(addStaffKey(authDb, token));
        expect(err?.message, token).toBe("staff_enrollment_invalid");
      }
      expect(await keysOf(user.id)).toBe(before.keys);
      expect(await head()).toEqual(before.head);
      expect((await enrolmentRow(live.id)).usedAt).toBeNull();
      expect((await enrolmentRow(expired.id)).usedAt).toBeNull();
    });

    test("refuses an account that was demoted, deleted or has no handle, and leaves its enrolment unspent", async () => {
      const cases: [string, Partial<typeof users.$inferInsert>][] = [
        ["demoted", { role: "user" }],
        ["deleted", { deletedAt: new Date() }],
        ["without a handle", { onboardedAt: null }],
      ];
      for (const [label, change] of cases) {
        const { user } = await newStaffAccount(authDb, repo);
        const enrolment = await issueEnrolment(migrateDb, user.id);
        await authDb.update(users).set(change).where(eq(users.id, user.id));
        const err = await pgError(addStaffKey(authDb, enrolment.token));
        expect(err?.message, label).toBe("staff_enrollment_invalid");
        expect((await enrolmentRow(enrolment.id)).usedAt, label).toBeNull();
        expect(await keysOf(user.id), label).toBe(0);
      }
    });

    test("refuses a sixth live key with staff_key_limit; a revoked key does not count", async () => {
      const { user } = await newStaffAccount(authDb, repo);
      const keys = [];
      for (let i = 0; i < 5; i++) keys.push(await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token));
      const sixth = await issueEnrolment(migrateDb, user.id);
      expect((await pgError(addStaffKey(authDb, sixth.token)))?.message).toBe("staff_key_limit");
      expect((await enrolmentRow(sixth.id)).usedAt).toBeNull();

      await authDb.update(staffKeys).set({ revokedAt: new Date() }).where(eq(staffKeys.id, keys[0]!.id));
      await addStaffKey(authDb, sixth.token);
      expect(await keysOf(user.id)).toBe(6);
    });

    test("refuses a credential id another key already has", async () => {
      const first = await newStaffKey(authDb, migrateDb, repo);
      const { user } = await newStaffAccount(authDb, repo);
      const enrolment = await issueEnrolment(migrateDb, user.id);
      expect((await pgError(addStaffKey(authDb, enrolment.token, { credentialId: first.key.credentialId })))?.code).toBe("23505");
      expect((await enrolmentRow(enrolment.id)).usedAt).toBeNull();
    });
  });

  describe("what the auth role cannot do", () => {
    test("it cannot insert a staff key or an enrolment, nor write the audit log itself", async () => {
      const { user, key } = await newStaffKey(authDb, migrateDb, repo);
      const refusals: [ReturnType<typeof sql>, RegExp][] = [
        [
          sql`insert into auth.staff_keys (user_id, credential_id, public_key, name, origin, rp_id) values (${user.id}::uuid, ${randomToken(16)}, 'cose-key', 'planted', ${TEST_CONSOLE_ORIGIN}, ${TEST_CONSOLE_RP_ID})`,
          /permission denied for table staff_keys/,
        ],
        [
          sql`insert into auth.staff_enrollments (user_id, token_hash, origin, rp_id, expires_at) values (${user.id}::uuid, ${sha256Hex(randomToken())}, ${TEST_CONSOLE_ORIGIN}, ${TEST_CONSOLE_RP_ID}, now() + interval '30 minutes')`,
          /permission denied for table staff_enrollments/,
        ],
        [sql`insert into public.audit_log (actor_id, action) values (${user.id}::uuid, 'role_granted')`, /permission denied for schema public/],
      ];
      for (const [statement, refusal] of refusals) expect((await asAuth(statement))?.message).toMatch(refusal);
      expect(await keysOf(user.id)).toBe(1);
      expect((await keyRow(key.id)).name).toBe(key.name);
    });

    test("it cannot delete a staff key, nor change its credential, public key, owner, name, AAGUID, origin, relying party ID or creation time", async () => {
      const { key } = await newStaffKey(authDb, migrateDb, repo);
      const other = await newStaffAccount(authDb, repo);
      const before = await keyRow(key.id);
      const refused = [
        sql`delete from auth.staff_keys where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set public_key = 'attacker-key' where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set credential_id = ${randomToken(16)} where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set user_id = ${other.user.id}::uuid where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set name = 'renamed' where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set aaguid = null where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set transports = '{}' where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set origin = 'http://evil.localhost', rp_id = 'evil.localhost' where id = ${key.id}::uuid`,
        sql`update auth.staff_keys set created_at = now() where id = ${key.id}::uuid`,
      ];
      for (const statement of refused) expect((await asAuth(statement))?.message).toMatch(/permission denied for table staff_keys/);
      expect(await keyRow(key.id)).toEqual(before);
    });

    test("it records a key's use, revocation and suspicion", async () => {
      const { key } = await newStaffKey(authDb, migrateDb, repo);
      const now = new Date();
      await authDb.update(staffKeys).set({ counter: 7, lastUsedAt: now }).where(eq(staffKeys.id, key.id));
      await authDb.update(staffKeys).set({ suspectAt: now, revokedAt: now }).where(eq(staffKeys.id, key.id));
      expect(await keyRow(key.id)).toMatchObject({ counter: 7, lastUsedAt: now, revokedAt: now, suspectAt: now });
    });

    test("a set revoked_at or suspect_at is never cleared or changed, and a key is never suspect without being revoked", async () => {
      const { key } = await newStaffKey(authDb, migrateDb, repo);
      const where = sql`where id = ${key.id}::uuid`;
      expect((await asAuth(sql`update auth.staff_keys set suspect_at = now() ${where}`))?.message).toMatch(/staff_keys_suspect_is_revoked/);
      expect(await asAuth(sql`update auth.staff_keys set revoked_at = now() ${where}`)).toBeNull();
      const revoked = await keyRow(key.id);
      for (const statement of [
        sql`update auth.staff_keys set revoked_at = null ${where}`,
        sql`update auth.staff_keys set revoked_at = revoked_at + interval '1 second' ${where}`,
      ]) {
        expect((await asAuth(statement))?.message).toMatch(/revoked_at is never cleared or changed/);
      }
      expect(await asAuth(sql`update auth.staff_keys set suspect_at = now() ${where}`)).toBeNull();
      for (const statement of [sql`update auth.staff_keys set suspect_at = null ${where}`, sql`update auth.staff_keys set suspect_at = suspect_at - interval '1 hour' ${where}`]) {
        expect((await asAuth(statement))?.message).toMatch(/suspect_at is never cleared or changed/);
      }
      // Unchanged values pass, so a revocation that repeats itself leaves the time it first recorded.
      expect(await asAuth(sql`update auth.staff_keys set revoked_at = coalesce(revoked_at, now()), counter = counter + 1 ${where}`)).toBeNull();
      expect((await keyRow(key.id)).revokedAt).toEqual(revoked.revokedAt);
    });

    test("it reads and deletes enrolments, and changes none of them", async () => {
      const { user } = await newStaffAccount(authDb, repo);
      const open = await issueEnrolment(migrateDb, user.id);
      for (const statement of [
        sql`update auth.staff_enrollments set used_at = now() where id = ${open.id}::uuid`,
        sql`update auth.staff_enrollments set expires_at = now() + interval '1 year' where id = ${open.id}::uuid`,
      ]) {
        expect((await asAuth(statement))?.message).toMatch(/permission denied for table staff_enrollments/);
      }
      expect(await authDb.select({ id: staffEnrollments.id }).from(staffEnrollments).where(eq(staffEnrollments.id, open.id))).toEqual([{ id: open.id }]);
      await authDb.delete(staffEnrollments).where(eq(staffEnrollments.id, open.id));
      expect(await migrateDb.$count(staffEnrollments, eq(staffEnrollments.id, open.id))).toBe(0);
    });

    test("a set used_at is never cleared or changed, even by the migrator that owns the table", async () => {
      const { enrolment } = await newStaffKey(authDb, migrateDb, repo);
      await rolledBack(migrateDb, async (tx) => {
        const err = await pgError(tx.transaction((sp) => sp.execute(sql`update auth.staff_enrollments set used_at = null where id = ${enrolment.id}::uuid`)));
        expect(err?.message).toMatch(/used_at is never cleared or changed/);
      });
      expect((await enrolmentRow(enrolment.id)).usedAt).toBeInstanceOf(Date);
    });
  });

  describe("staff sessions", () => {
    const session = (userId: string, keyId: string, created: Date, idleMs: number, absoluteMs: number) => ({
      id: sha256Hex(randomToken()),
      userId,
      keyId,
      createdAt: created,
      lastUsedAt: created,
      idleExpiresAt: new Date(created.getTime() + idleMs),
      absoluteExpiresAt: new Date(created.getTime() + absoluteMs),
      browser: "Firefox on Linux",
    });

    test("a session opened with the account's own key, for at most 12 hours, is stored with a random handle", async () => {
      const { user, key } = await newStaffKey(authDb, migrateDb, repo);
      const [row] = await authDb.insert(staffSessions).values(session(user.id, key.id, new Date(), 15 * 60_000, 12 * HOUR)).returning();
      expect(row!.handle).toMatch(/^[0-9a-f-]{36}$/);
      expect(row).toMatchObject({ userId: user.id, keyId: key.id, revokedAt: null, browser: "Firefox on Linux" });
    });

    test("a session lasting beyond 12 hours, or idle past its absolute end, is refused", async () => {
      const { user, key } = await newStaffKey(authDb, migrateDb, repo);
      for (const [label, values] of [
        ["12 hours and 1 ms", session(user.id, key.id, new Date(), 15 * 60_000, 12 * HOUR + 1)],
        ["idle past the absolute end", session(user.id, key.id, new Date(), 2 * HOUR, HOUR)],
      ] as const) {
        const err = await pgError(authDb.insert(staffSessions).values(values));
        expect(err, label).toMatchObject({ code: "23514", message: expect.stringMatching(/staff_sessions_lifetime/) });
      }
    });

    test("a session pairing an account with another account's key is refused", async () => {
      const owner = await newStaffKey(authDb, migrateDb, repo);
      const other = await newStaffAccount(authDb, repo);
      const err = await pgError(authDb.insert(staffSessions).values(session(other.user.id, owner.key.id, new Date(), 15 * 60_000, 12 * HOUR)));
      expect(err).toMatchObject({ code: "23503", message: expect.stringMatching(/staff_sessions_key_user_fk/) });
    });
  });

  describe("auth.forget_staff_keys", () => {
    test("changes nothing for a live account", async () => {
      const { user, key } = await newStaffKey(authDb, migrateDb, repo);
      const before = await keyRow(key.id);
      const [result] = await authDb.execute<{ n: number }>(sql`select auth.forget_staff_keys(${user.id}::uuid) as n`);
      expect(result!.n).toBe(0);
      expect(await keyRow(key.id)).toEqual(before);
    });

    test("blanks a deleted account's revoked key names, AAGUIDs and transports, keeping what audit-verify needs", async () => {
      const { user, key } = await newStaffKey(authDb, migrateDb, repo);
      await addStaffKey(authDb, (await issueEnrolment(migrateDb, user.id)).token);
      // As the take-down leaves them before it calls the function: the account marked deleted, every key revoked.
      const revokedAt = new Date();
      await authDb.update(staffKeys).set({ revokedAt }).where(eq(staffKeys.userId, user.id));
      const before = await keyRow(key.id);
      await authDb.update(users).set({ deletedAt: new Date() }).where(eq(users.id, user.id));
      const [result] = await authDb.execute<{ n: number }>(sql`select auth.forget_staff_keys(${user.id}::uuid) as n`);
      expect(result!.n).toBe(2);
      expect(await keyRow(key.id)).toEqual({ ...before, name: "", aaguid: null, transports: [] });
    });

    test("never blanks a live key, even when the auth role marks the account deleted around the call", async () => {
      // The auth role may set and clear deleted_at, so the account's mark alone cannot guard the keys the column grants
      // keep it from changing; a key it has not revoked (which it can never undo) is never blanked.
      const { user, key } = await newStaffKey(authDb, migrateDb, repo);
      const before = await keyRow(key.id);
      const forgotten = await withLockTimeout(authDb, async (tx) => {
        await tx.update(users).set({ deletedAt: new Date() }).where(eq(users.id, user.id));
        const [result] = await tx.execute<{ n: number }>(sql`select auth.forget_staff_keys(${user.id}::uuid) as n`);
        await tx.update(users).set({ deletedAt: null }).where(eq(users.id, user.id));
        return result!.n;
      });
      expect(forgotten).toBe(0);
      expect(await keyRow(key.id)).toEqual(before);
      expect((await repo.findUserById(user.id))!.deletedAt).toBeNull();
    });
  });

  describe("auth.append_audit", () => {
    test("writes each of the auth side's actions, in the caller's transaction", async () => {
      const start = await head();
      await rolledBack(authDb, async (tx) => {
        for (const [i, action] of AUTH_SIDE_ACTIONS.entries()) {
          const [row] = await tx.execute<{ place: number }>(
            sql`select auth.append_audit(${randomUUID()}::uuid, ${action}, 'staff_session', ${randomUUID()}, '{"via":"test"}'::jsonb, null, null, null, null, 'req-1')::int as place`,
          );
          expect(row!.place, action).toBe(start.seq + i + 1);
        }
        // A confirmed action carries its hash, its assertion and the key.
        const stepUp = JSON.stringify({ authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" });
        const [confirmed] = await tx.execute<{ place: number }>(
          sql`select auth.append_audit(${randomUUID()}::uuid, 'staff_session_revoked', 'staff_session', ${randomUUID()}, '{"params":{}}'::jsonb, ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${"ab".repeat(32)}, ${stepUp}::jsonb, 'req-2')::int as place`,
        );
        expect(confirmed!.place).toBe(start.seq + AUTH_SIDE_ACTIONS.length + 1);
      });
      expect(await head()).toEqual(start);
    });

    test("stores every column it is given, and an absent metadata as an empty object", async () => {
      const actorId = randomUUID();
      const staffSession = randomUUID();
      const keyId = randomUUID();
      const [written] = await withLockTimeout(authDb, (tx) =>
        tx.execute<{ place: number }>(
          sql`select auth.append_audit(${actorId}::uuid, 'staff_signed_out', 'staff_session', ${staffSession}, null, ${staffSession}::uuid, ${keyId}::uuid, null, null, 'req-signout')::int as place`,
        ),
      );
      const [row] = await apiDb.select().from(auditLog).where(eq(auditLog.chainSeq, written!.place));
      expect(row).toMatchObject({ actorId, action: "staff_signed_out", targetType: "staff_session", targetId: staffSession, metadata: {}, staffSession, keyId, actionHash: null, stepUp: null, requestId: "req-signout", chainVersion: 1 });
    });

    test("refuses every action outside its list, and writes nothing", async () => {
      const start = await head();
      for (const action of ["staff_key_added", "staff_enrollment_issued", "case_decided", "role_granted ", "", null]) {
        const err = await asAuth(sql`select auth.append_audit(${randomUUID()}::uuid, ${action}::text, null, null, '{}'::jsonb, null, null, null, null, null)`);
        expect(err?.message, String(action)).toMatch(/^auth\.append_audit does not write the action /);
      }
      expect(await head()).toEqual(start);
    });

    test("does not write a step-up without its key, as the table's check refuses", async () => {
      const stepUp = JSON.stringify({ authenticatorData: "AAAA", clientDataJSON: "BBBB", signature: "CCCC" });
      const err = await asAuth(sql`select auth.append_audit(${randomUUID()}::uuid, 'staff_session_revoked', null, null, '{}'::jsonb, null, null, ${"ab".repeat(32)}, ${stepUp}::jsonb, null)`);
      expect(err).toMatchObject({ code: "23514", message: expect.stringMatching(/audit_log_step_up_complete/) });
    });
  });

  test("the migrator owns every staff and chain function, pins its search path, and grants EXECUTE to the auth role alone", async () => {
    const rows = await apiDb.execute<{ name: string; owner: string; definer: boolean; config: string[] | null; api: boolean; auth: boolean }>(sql`
      select p.pronamespace::regnamespace::text || '.' || p.proname as name, p.proowner::regrole::text as owner, p.prosecdef as definer,
             p.proconfig as config, has_function_privilege('korbat_api', p.oid, 'execute') as api,
             has_function_privilege('korbat_auth', p.oid, 'execute') as auth
        from pg_proc p
       where (p.pronamespace = 'auth'::regnamespace and p.proname in ('add_staff_key', 'append_audit', 'forget_staff_keys', 'staff_never_cleared'))
          or (p.pronamespace = 'public'::regnamespace and p.proname in ('audit_chain', 'audit_chain_text'))
       order by 1`);
    const auth = ["search_path=auth, pg_temp"];
    const pub = ["search_path=public, pg_temp"];
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { name: "auth.add_staff_key", owner: "korbat_migrate", definer: true, config: auth, api: false, auth: true },
      { name: "auth.append_audit", owner: "korbat_migrate", definer: true, config: auth, api: false, auth: true },
      { name: "auth.forget_staff_keys", owner: "korbat_migrate", definer: true, config: auth, api: false, auth: true },
      // A trigger function: it fires whoever writes the row, and nobody calls it.
      { name: "auth.staff_never_cleared", owner: "korbat_migrate", definer: false, config: auth, api: false, auth: false },
      { name: "public.audit_chain", owner: "korbat_migrate", definer: true, config: pub, api: false, auth: false },
      { name: "public.audit_chain_text", owner: "korbat_migrate", definer: false, config: pub, api: false, auth: false },
    ]);
  });
});
```

### Replace `apps/api/test/integration/staff-signin.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { StaffMe, type AuthenticationResponseJSON } from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, passkeys, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { challengeKey, issueChallenge, readChallenge } from "../../src/auth/passkeys/challenge";
import { registerOptions, registerVerify, signInOptions as passkeySignInOptions, signInVerify as passkeySignInVerify } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { STAFF_ABSOLUTE_MS, STAFF_IDLE_MS } from "../../src/auth/staff/sessions";
import { STAFF_SIGNIN_PER_IP_PER_HOUR, STAFF_SIGNIN_PER_KEY_PER_HOUR, signInOptions, signInVerify } from "../../src/auth/staff/signin";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";
import { DEVICE_BOUND, TEST_CONSOLE, TEST_CONSOLE_ORIGIN, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount } from "./staff-fixtures";
import { enrolKey } from "./staff-enrolment";
import { signInKey, staffAssertion } from "./staff-sign-in";

const APP_ORIGIN = "http://localhost:8081";
const NO_UV: SoftFlags = { up: true, uv: false, be: false, bs: false };
const SYNCABLE: SoftFlags = { up: true, uv: true, be: true, bs: false };
const SYNCED: SoftFlags = { up: true, uv: true, be: true, bs: true };
/** BS without BE: no authenticator may report it (WebAuthn L3, section 6.1.3), and the library refuses it with the signature. */
const BACKED_UP_ONLY: SoftFlags = { up: true, uv: true, be: false, bs: true };
/** A time as the staff mails print it, as 1c's mails do: the date and the minute in UTC. */
const mailTime = (at: Date) => `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)} UTC`;

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/** A response's signature with its last byte changed: the library's check fails, and nothing else about it does. */
function badSignature(response: AuthenticationResponseJSON): AuthenticationResponseJSON {
  const signature = Buffer.from(response.response.signature, "base64url");
  signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
  return { ...response, response: { ...response.response, signature: signature.toString("base64url") } };
}

/**
 * The staff sign-in through the auth module's flows on the real database (3a design, section 7, Sign-in and A counter that
 * goes backwards): the console at http://console.localhost:8090 with the relying party console.localhost beside the app at
 * http://localhost:8081, the software authenticator, and keys enrolled through the enrolment flow.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff sign-in", () => {
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    authDb = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    // The migrate role reads every row back; the test environment carries its URL.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 4 });
    repo = createAuthRepo(authDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(migrateDb)]);
  });

  const harness = () => flowHarness(repo, { console: TEST_CONSOLE });
  const head = async () => (await migrateDb.select().from(auditHead))[0]!;
  const keyRow = async (id: string) => (await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, id)))[0]!;
  const sessionsOf = (userId: string) => migrateDb.select().from(staffSessions).where(eq(staffSessions.userId, userId)).orderBy(asc(staffSessions.createdAt));
  const staffEvents = (userId: string) =>
    migrateDb
      .select({ type: authEvents.type, metadata: authEvents.metadata, ipHash: authEvents.ipHash })
      .from(authEvents)
      .where(and(eq(authEvents.userId, userId), sql`${authEvents.type}::text in ('staff_sign_in', 'staff_key_counter_regression', 'staff_key_revoked')`))
      .orderBy(asc(authEvents.id));
  const rowsAfter = (seq: number) => migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, seq)).orderBy(asc(auditLog.chainSeq));

  /** A live staff account with a handle (in the harness's profiles) holding one key enrolled through the flow. */
  async function staffWithKey(h: FlowHarness, name = "Blue key") {
    const { user } = await newStaffAccount(authDb, repo);
    const handle = `s_${randomUUID().slice(0, 8)}`;
    await h.deps.profiles.create({ id: user.id, handle, displayName: "Staff" });
    const auth = new SoftAuthenticator();
    const enrolled = await enrolKey(h, auth, (await issueEnrolment(migrateDb, user.id)).token, { name });
    return { user, handle, auth, keyId: enrolled.key.id, credentialId: enrolled.credentialId };
  }

  describe("a sign-in with a live staff key", () => {
    test("the options ask for a discoverable, user-verified credential of the console's relying party with a staff sign-in challenge", async () => {
      const h = harness();
      const { options } = await signInOptions(h.deps);
      expect(options.rpId).toBe(TEST_CONSOLE_RP_ID);
      expect(options.allowCredentials ?? []).toEqual([]);
      expect(options.userVerification).toBe("required");
      expect(options.timeout).toBe(5 * MINUTE);
      const key = challengeKey(h.deps.config.authHmacKey);
      expect(() => readChallenge(key, options.challenge, "staff_signin", h.clock.now())).not.toThrow();
      // Only a staff sign-in: the app's sign-in, and every other purpose, refuse it.
      expect(() => readChallenge(key, options.challenge, "signin", h.clock.now())).toThrow();
      expect(() => readChallenge(key, options.challenge, "staff_register", h.clock.now())).toThrow();
    });

    test("opens a session with its browser label, records the key's use, writes staff_sign_in and its audit row last in the session's transaction, and mails the owner after the commit", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, handle, auth, keyId, credentialId } = await staffWithKey(h);
      h.mailer.sent.length = 0;
      const before = await head();
      const now = h.clock.now();
      const { token, me, requestId } = await signInKey(h, auth, credentialId, { counter: 7 });

      // The answer is /me's: the handle, the role, the session's handle and both ends with the seconds left.
      const [session] = await sessionsOf(user.id);
      expect(StaffMe.parse(me)).toEqual({
        handle,
        role: "moderator",
        sessionHandle: session!.handle,
        idleExpiresAt: new Date(now.getTime() + STAFF_IDLE_MS).toISOString(),
        idleSecondsLeft: 15 * 60,
        absoluteExpiresAt: new Date(now.getTime() + STAFF_ABSOLUTE_MS).toISOString(),
        absoluteSecondsLeft: 12 * 60 * 60,
      });
      // The token is the cookie's value; only its sha256 is stored. The label is deviceLabel's, never the user agent.
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(session).toMatchObject({
        id: sha256Hex(token),
        userId: user.id,
        keyId,
        createdAt: now,
        lastUsedAt: now,
        idleExpiresAt: new Date(now.getTime() + 15 * MINUTE),
        absoluteExpiresAt: new Date(now.getTime() + 12 * HOUR),
        revokedAt: null,
        browser: "Chrome on Windows",
      });
      expect(await keyRow(keyId)).toMatchObject({ counter: 7, lastUsedAt: now, revokedAt: null, suspectAt: null });

      // The event names the key and the session; the audit row the account, the session and the key, with the request's id.
      expect(await staffEvents(user.id)).toEqual([{ type: "staff_sign_in", metadata: { keyId, handle: session!.handle }, ipHash: h.ctx.ipHash }]);
      const written = await rowsAfter(before.seq);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        actorId: user.id,
        action: "staff_sign_in",
        targetType: "staff_session",
        targetId: session!.handle,
        staffSession: session!.handle,
        keyId,
        actionHash: null,
        stepUp: null,
        requestId,
        metadata: {},
      });
      // One transaction: the key's use, the session, the event and the audit row carry one transaction id, the audit row
      // written by its last statement.
      const [rows] = await migrateDb.execute<{ key: string; session: string; event: string; audit: string; keyCmin: string; sessionCmin: string; eventCmin: string; auditCmin: string }>(sql`select
        (select xmin::text from auth.staff_keys where id = ${keyId}) as key,
        (select xmin::text from auth.staff_sessions where user_id = ${user.id}) as session,
        (select xmin::text from auth.auth_events where user_id = ${user.id} and type = 'staff_sign_in') as event,
        (select xmin::text from public.audit_log where id = ${written[0]!.id}) as audit,
        (select cmin::text from auth.staff_keys where id = ${keyId}) as "keyCmin",
        (select cmin::text from auth.staff_sessions where user_id = ${user.id}) as "sessionCmin",
        (select cmin::text from auth.auth_events where user_id = ${user.id} and type = 'staff_sign_in') as "eventCmin",
        (select cmin::text from public.audit_log where id = ${written[0]!.id}) as "auditCmin"`);
      expect(new Set([rows!.key, rows!.session, rows!.event, rows!.audit]).size).toBe(1);
      expect(Number(rows!.auditCmin)).toBeGreaterThan(Math.max(Number(rows!.keyCmin), Number(rows!.sessionCmin), Number(rows!.eventCmin)));

      // The owner learns of every staff session: the key's name, the browser label and the time; no link.
      expect(h.mailer.sent).toEqual([{ to: user.email, template: "staff_session_started", data: { name: "Blue key", browser: "Chrome on Windows", time: mailTime(now) } }]);
    });

    test("each sign-in is a session of its own, with the label of the browser it came from", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, auth, credentialId } = await staffWithKey(h);
      await signInKey(h, auth, credentialId, { counter: 1 });
      h.ctx.userAgent = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
      await signInKey(h, auth, credentialId, { counter: 2 });
      h.ctx.userAgent = undefined;
      await signInKey(h, auth, credentialId, { counter: 3 });
      expect((await sessionsOf(user.id)).map((s) => s.browser)).toEqual(["Chrome on Windows", "Firefox on Linux", "Browser on unknown OS"]);
    });

    test("an authenticator that always reports a zero counter signs in again and again", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, auth, credentialId } = await staffWithKey(h);
      await signInKey(h, auth, credentialId, { counter: 0 });
      await signInKey(h, auth, credentialId, { counter: 0 });
      expect(await sessionsOf(user.id)).toHaveLength(2);
    });
  });

  describe("one answer before the signature", () => {
    test("an unknown key, a revoked key, a demoted or deleted account, and a missing or wrong user handle are all staff_key_invalid, with one message, and write nothing", { timeout: 60_000 }, async () => {
      const h = harness();
      const answers: [string, AuthError][] = [];
      const attempt = async (label: string, run: Promise<unknown>) => answers.push([label, await failure(run)]);

      // A credential the authenticator holds but korbat never stored.
      const stranger = new SoftAuthenticator();
      const unknown = stranger.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });
      await attempt("an unknown key", signInKey(h, stranger, unknown.id));

      const revoked = await staffWithKey(h);
      await authDb.update(staffKeys).set({ revokedAt: new Date() }).where(eq(staffKeys.id, revoked.keyId));
      await attempt("a revoked key", signInKey(h, revoked.auth, revoked.credentialId));

      const demoted = await staffWithKey(h);
      await authDb.update(users).set({ role: "user" }).where(eq(users.id, demoted.user.id));
      await attempt("a demoted account", signInKey(h, demoted.auth, demoted.credentialId));

      const deleted = await staffWithKey(h);
      await authDb.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deleted.user.id));
      await attempt("a deleted account", signInKey(h, deleted.auth, deleted.credentialId));

      const live = await staffWithKey(h);
      await attempt("no user handle", signInKey(h, live.auth, live.credentialId, { userHandle: null }));
      await attempt("a random user handle", signInKey(h, live.auth, live.credentialId, { userHandle: randomBytes(32) }));
      const other = await staffWithKey(h);
      const otherHandle = (await repo.findUserById(other.user.id))!.webauthnUserId!;
      await attempt("another account's user handle", signInKey(h, live.auth, live.credentialId, { userHandle: otherHandle }));

      for (const [label, err] of answers) {
        expect([label, err.code, err.status, err.message]).toEqual([label, "staff_key_invalid", 401, answers[0]![1].message]);
      }
      for (const account of [revoked, demoted, deleted, live]) {
        expect(await sessionsOf(account.user.id)).toEqual([]);
        expect((await keyRow(account.keyId)).counter).toBe(0);
        expect((await keyRow(account.keyId)).lastUsedAt).toBeNull();
      }
      // The live key still opens the console with its own handle.
      expect((await signInKey(h, live.auth, live.credentialId)).me.handle).toBe(live.handle);
    });

    test("whatever the codec or the library refuses is staff_key_invalid, never a passkey code; an expired challenge is challenge_expired", { timeout: 60_000 }, async () => {
      const h = harness();
      const { user, keyId, auth, credentialId } = await staffWithKey(h);
      const key = challengeKey(h.deps.config.authHmacKey);
      const verify = (response: AuthenticationResponseJSON) => failure(signInVerify(h.deps, { response }, { ...h.ctx, requestId: `req-${randomUUID()}` }));
      const assert = (options: Parameters<typeof staffAssertion>[3] = {}) => staffAssertion(h, auth, credentialId, options);

      const used = await signInKey(h, auth, credentialId, { counter: 1 });
      const cases: [string, AuthenticationResponseJSON][] = [
        ["a spent challenge", auth.get({ credentialId, rpId: TEST_CONSOLE_RP_ID, challenge: JSON.parse(Buffer.from(used.response.response.clientDataJSON, "base64url").toString()).challenge, origin: TEST_CONSOLE_ORIGIN, flags: DEVICE_BOUND, counter: 2 })],
        ["the app's sign-in challenge", await assert({ challenge: issueChallenge(key, "signin", h.clock.now()), counter: 3 })],
        ["a staff registration challenge", await assert({ challenge: issueChallenge(key, "staff_register", h.clock.now(), randomUUID()), counter: 4 })],
        ["a staff sign-in challenge bound to something", await assert({ challenge: issueChallenge(key, "staff_signin", h.clock.now(), randomUUID()), counter: 5 })],
        ["a forged challenge", await assert({ challenge: randomBytes(58).toString("base64url"), counter: 6 })],
        ["not a challenge at all", await assert({ challenge: "x", counter: 7 })],
        ["the app's relying party", await assert({ rpId: "localhost", counter: 8 })],
        ["the app's origin", await assert({ origin: APP_ORIGIN, counter: 9 })],
        ["a bad signature", badSignature(await assert({ counter: 10 }))],
        ["a bad signature that also reports no UV", badSignature(await assert({ counter: 11, flags: NO_UV }))],
      ];
      for (const [label, response] of cases) {
        const err = await verify(response);
        expect([label, err.code, err.status]).toEqual([label, "staff_key_invalid", 401]);
        expect(err.code, label).not.toMatch(/^passkey_/);
      }
      // None of them touched the key or opened a session; the key's counter is the one good sign-in's.
      expect((await keyRow(keyId)).counter).toBe(1);
      expect(await sessionsOf(user.id)).toHaveLength(1);

      // An expired challenge is the shared code the console answers by starting over.
      const late = await assert({ counter: 12 });
      h.clock.advance(10 * MINUTE);
      expect((await verify(late)).code).toBe("challenge_expired");
      expect((await signInKey(h, auth, credentialId, { counter: 13 })).me.role).toBe("moderator");
    });
  });

  describe("user verification and device binding, after the signature", () => {
    test("an assertion without UV is staff_key_not_user_verified, one reporting BE, backed up or not, staff_key_not_device_bound; none moves the counter or opens a session", { timeout: 30_000 }, async () => {
      const h = harness();
      const { user, keyId, auth, credentialId } = await staffWithKey(h);
      const before = await head();
      const cases: [SoftFlags, string, number][] = [
        [NO_UV, "staff_key_not_user_verified", 403],
        [SYNCABLE, "staff_key_not_device_bound", 403],
        [SYNCED, "staff_key_not_device_bound", 403],
        [BACKED_UP_ONLY, "staff_key_invalid", 401],
      ];
      for (const [flags, code, status] of cases) {
        const err = await failure(signInKey(h, auth, credentialId, { flags, counter: 5 }));
        expect([JSON.stringify(flags), err.code, err.status]).toEqual([JSON.stringify(flags), code, status]);
      }
      expect(await keyRow(keyId)).toMatchObject({ counter: 0, lastUsedAt: null, revokedAt: null });
      expect(await sessionsOf(user.id)).toEqual([]);
      expect(await head()).toEqual(before);
      // The counter the refused assertions reported is still ahead of the stored one.
      await signInKey(h, auth, credentialId, { counter: 5 });
    });
  });

  describe("a counter that goes backwards", () => {
    test("revokes the key and marks it suspect, revokes every live staff session it opened, records it last in one transaction, mails staff_key_suspect and answers staff_key_suspended", { timeout: 60_000 }, async () => {
      const h = harness();
      const { user, keyId, auth, credentialId } = await staffWithKey(h);
      const red = await enrolKey(h, auth, (await issueEnrolment(migrateDb, user.id)).token, { name: "Red key" });
      const first = await signInKey(h, auth, credentialId, { counter: 5 });
      const second = await signInKey(h, auth, credentialId, { counter: 6 });
      const onRed = await signInKey(h, auth, red.credentialId, { counter: 1 });
      // A session the key opened that has already ended stays as it was.
      const ended = new Date(h.clock.ms() - MINUTE);
      await authDb.update(staffSessions).set({ revokedAt: ended }).where(eq(staffSessions.id, sha256Hex(first.token)));
      const third = await signInKey(h, auth, credentialId, { counter: 7 });
      h.mailer.sent.length = 0;
      const before = await head();
      const now = h.clock.now();

      const err = await failure(signInKey(h, auth, credentialId, { counter: 7 }));
      expect([err.code, err.status]).toEqual(["staff_key_suspended", 403]);

      expect(await keyRow(keyId)).toMatchObject({ revokedAt: now, suspectAt: now, counter: 7 });
      expect(await keyRow(red.key.id)).toMatchObject({ revokedAt: null, suspectAt: null });
      const byId = new Map((await sessionsOf(user.id)).map((s) => [s.id, s.revokedAt]));
      expect(byId.get(sha256Hex(first.token))).toEqual(ended);
      expect(byId.get(sha256Hex(second.token))).toEqual(now);
      expect(byId.get(sha256Hex(third.token))).toEqual(now);
      expect(byId.get(sha256Hex(onRed.token))).toBeNull();
      expect(byId.size).toBe(4);

      const regression = (await staffEvents(user.id)).filter((e) => e.type === "staff_key_counter_regression");
      expect(regression.map((e) => e.metadata)).toEqual([{ keyId, sessionsRevoked: 2, via: "sign_in" }]);
      const written = await rowsAfter(before.seq);
      expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.keyId, r.metadata])).toEqual([
        ["staff_key_counter_regression", user.id, "staff_key", keyId, null, { keyId, sessionsRevoked: 2, via: "sign_in" }],
      ]);
      // One transaction: the key, the revoked sessions, the event and the audit row, which its last statement wrote.
      const [rows] = await migrateDb.execute<{ key: string; sessions: string; event: string; audit: string; eventCmin: string; auditCmin: string }>(sql`select
        (select xmin::text from auth.staff_keys where id = ${keyId}) as key,
        (select string_agg(distinct xmin::text, ',') from auth.staff_sessions where id in (${sha256Hex(second.token)}, ${sha256Hex(third.token)})) as sessions,
        (select xmin::text from auth.auth_events where user_id = ${user.id} and type = 'staff_key_counter_regression') as event,
        (select xmin::text from public.audit_log where id = ${written[0]!.id}) as audit,
        (select cmin::text from auth.auth_events where user_id = ${user.id} and type = 'staff_key_counter_regression') as "eventCmin",
        (select cmin::text from public.audit_log where id = ${written[0]!.id}) as "auditCmin"`);
      expect(new Set([rows!.key, rows!.sessions, rows!.event, rows!.audit]).size).toBe(1);
      expect(Number(rows!.auditCmin)).toBeGreaterThan(Number(rows!.eventCmin));

      // Never passkey_suspect, whose remedy names the app's Security screen.
      expect(h.mailer.sent).toEqual([{ to: user.email, template: "staff_key_suspect", data: { name: "Blue key" } }]);
      // The key opens nothing more, whatever counter it reports; the account's other key still does.
      expect((await failure(signInKey(h, auth, credentialId, { counter: 100 }))).code).toBe("staff_key_invalid");
      expect((await signInKey(h, auth, red.credentialId, { counter: 2 })).me.role).toBe("moderator");
    });

    test("a counter that stays at a non-zero value is a regression too", { timeout: 30_000 }, async () => {
      const h = harness();
      const { keyId, auth, credentialId } = await staffWithKey(h);
      await signInKey(h, auth, credentialId, { counter: 3 });
      expect((await failure(signInKey(h, auth, credentialId, { counter: 2 }))).code).toBe("staff_key_suspended");
      expect((await keyRow(keyId)).suspectAt).not.toBeNull();
    });
  });

  describe("limits", () => {
    test("per IP, 20 attempts an hour, counted before anything else: the 21st is rate_limited and spends no challenge", { timeout: 60_000 }, async () => {
      const h = harness();
      const { auth, credentialId } = await staffWithKey(h);
      const stranger = new SoftAuthenticator();
      const junk = stranger.create({ rpId: TEST_CONSOLE_RP_ID, challenge: randomBytes(58).toString("base64url"), origin: TEST_CONSOLE_ORIGIN, userHandle: randomBytes(32), flags: DEVICE_BOUND });
      for (let i = 0; i < STAFF_SIGNIN_PER_IP_PER_HOUR; i++) expect((await failure(signInKey(h, stranger, junk.id))).code).toBe("staff_key_invalid");
      const response = await staffAssertion(h, auth, credentialId);
      const limited = await failure(signInVerify(h.deps, { response }, { ...h.ctx, requestId: "req-limited" }));
      expect([limited.code, limited.status, limited.retryAfterSeconds]).toEqual(["rate_limited", 429, 3600]);
      // The same answer from another address: its challenge was never spent.
      const signed = await signInVerify(h.deps, { response }, { ...h.ctx, ipHash: randomToken(), requestId: "req-other-ip" });
      expect(signed.me.role).toBe("moderator");
      // An hour later the address may try again.
      h.clock.advance(HOUR);
      expect((await signInKey(h, auth, credentialId, { counter: 2 })).me.role).toBe("moderator");
    });

    test("per key, 10 an hour, counted only after the signature and the flags: ten unsigned answers and refused flags leave the owner able to sign in", { timeout: 90_000 }, async () => {
      const h = harness();
      const { auth, credentialId } = await staffWithKey(h);
      const elsewhere = () => randomToken();
      // Someone who knows the key's credential id but not its private key, from as many addresses as they like.
      for (let i = 0; i < STAFF_SIGNIN_PER_KEY_PER_HOUR + 2; i++) {
        const forged = badSignature(await staffAssertion(h, auth, credentialId, { counter: 50 }));
        expect((await failure(signInVerify(h.deps, { response: forged }, { ...h.ctx, ipHash: elsewhere(), requestId: `req-forged-${i}` }))).code).toBe("staff_key_invalid");
      }
      // Assertions the key really signed but that the flags refuse are not counted either.
      for (let i = 0; i < 3; i++) expect((await failure(signInKey(h, auth, credentialId, { flags: NO_UV, ipHash: elsewhere() }))).code).toBe("staff_key_not_user_verified");
      // The owner signs in ten times within the hour; the eleventh is refused.
      for (let i = 1; i <= STAFF_SIGNIN_PER_KEY_PER_HOUR; i++) await signInKey(h, auth, credentialId, { counter: i, ipHash: elsewhere() });
      const limited = await failure(signInKey(h, auth, credentialId, { counter: 11, ipHash: elsewhere() }));
      expect([limited.code, limited.status]).toEqual(["rate_limited", 429]);
      h.clock.advance(HOUR);
      await signInKey(h, auth, credentialId, { counter: 12, ipHash: elsewhere() });
    });
  });

  describe("relying parties", () => {
    test("a personal passkey's assertion made for the console's relying party is refused at the app's sign-in on the relying-party check, leaving the passkey as it was", { timeout: 30_000 }, async () => {
      // The relying parties apart, as in production: the app's localhost, the console's console.localhost.
      const h = harness();
      const account = await onboardedUser(h, repo);
      const phone = new SoftAuthenticator();
      const registration = (await registerOptions(h.deps, account.session, { label: "ada" })).options;
      // Device-bound and user-verifying, so nothing but where the assertion was made for can refuse it.
      const personal = phone.create({ rpId: "localhost", challenge: registration.challenge, origin: APP_ORIGIN, userHandle: Buffer.from(registration.user.id, "base64url"), flags: DEVICE_BOUND });
      await registerVerify(h.deps, account.session, { response: personal });
      const stored = async () => (await migrateDb.select().from(passkeys).where(eq(passkeys.credentialId, personal.id)))[0]!;
      const before = await stored();
      expect(before).toMatchObject({ counter: 0, lastUsedAt: null, suspectAt: null });
      /** The app's passkey sign-in with an assertion the phone signs for this relying party ID from this origin. */
      const passkeySignIn = async (rpId: string, origin: string, counter: number) => {
        const { options } = await passkeySignInOptions(h.deps, h.ctx);
        const response = phone.get({ credentialId: personal.id, rpId, challenge: options.challenge, origin, flags: DEVICE_BOUND, counter });
        return passkeySignInVerify(h.deps, { deviceId: account.device.deviceId, platform: "web", response }, h.ctx);
      };

      // As a browser on the console's page makes it, carrying the console's origin too, which the library checks first; then
      // from the app's own origin, which passes, so that only the relying party ID in the authenticator data can refuse it.
      for (const [label, origin] of [
        ["from the console's origin", TEST_CONSOLE_ORIGIN],
        ["from the app's origin", APP_ORIGIN],
      ] as const) {
        const err = await failure(passkeySignIn(TEST_CONSOLE_RP_ID, origin, 5));
        expect([label, err.code, err.status]).toEqual([label, "passkey_invalid", 401]);
      }
      // Refused before the passkey's use is recorded: its counter, last use and suspect mark are untouched.
      expect(await stored()).toEqual(before);
      // The same passkey, origin and counter with the app's relying party ID sign in, so the ID alone refused the one above.
      expect((await passkeySignIn("localhost", APP_ORIGIN, 5)).kind).toBe("session");
      expect((await stored()).counter).toBe(5);
    });

    test("a key enrolled for the console at another address with the same relying party ID opens nothing at this one: staff_key_invalid before the signature, writing nothing", { timeout: 60_000 }, async () => {
      // The console moved from port 8091 to 8090 and kept its relying party ID, so the browser still offers the key; its
      // assertion names the new origin, which the running configuration accepts. The key records the old one, against
      // which audit-verify would judge every confirmation it made here, and refuse each one for good.
      const MOVED_FROM = "http://console.localhost:8091";
      const before = flowHarness(repo, { console: { origin: MOVED_FROM, rpId: TEST_CONSOLE_RP_ID } });
      const { user } = await newStaffAccount(authDb, repo);
      await before.deps.profiles.create({ id: user.id, handle: `s_${randomUUID().slice(0, 8)}`, displayName: "Staff" });
      const auth = new SoftAuthenticator();
      const enrolled = await enrolKey(before, auth, (await issueEnrolment(migrateDb, user.id, { origin: MOVED_FROM })).token);
      expect(await keyRow(enrolled.key.id)).toMatchObject({ origin: MOVED_FROM, rpId: TEST_CONSOLE_RP_ID });

      const moved = harness();
      const err = await failure(signInKey(moved, auth, enrolled.credentialId, { counter: 1 }));
      expect([err.code, err.status]).toEqual(["staff_key_invalid", 401]);
      // The same one answer as an unknown key, before the signature: nothing opened, nothing recorded.
      expect(await sessionsOf(user.id)).toEqual([]);
      expect(await keyRow(enrolled.key.id)).toMatchObject({ counter: 0, lastUsedAt: null, revokedAt: null });
      // The key opens the console at the address it was enrolled for.
      expect((await signInKey(before, auth, enrolled.credentialId, { counter: 2 })).me.role).toBe("moderator");
    });

    test("with both relying party IDs localhost (development), a personal passkey offered at the console's sign-in is refused by the tables alone", { timeout: 60_000 }, async () => {
      // The development configuration: the console at http://localhost:8090, its relying party ID the app's.
      const h = flowHarness(repo, { console: { origin: "http://localhost:8090", rpId: "localhost" } });
      const account = await onboardedUser(h, repo);
      await h.deps.profiles.create({ id: account.user.id, handle: `s_${randomUUID().slice(0, 8)}`, displayName: "Staff" });
      const phone = new SoftAuthenticator();
      const personalOptions = (await registerOptions(h.deps, account.session, { label: "ada" })).options;
      // A device-bound, user-verifying personal passkey: its flags would pass, so only the lookup can refuse it.
      const personal = phone.create({ rpId: "localhost", challenge: personalOptions.challenge, origin: APP_ORIGIN, userHandle: Buffer.from(personalOptions.user.id, "base64url"), flags: DEVICE_BOUND });
      await registerVerify(h.deps, account.session, { response: personal });
      await authDb.update(users).set({ role: "moderator" }).where(eq(users.id, account.user.id));
      const securityKey = new SoftAuthenticator();
      const staff = await enrolKey(h, securityKey, (await issueEnrolment(migrateDb, account.user.id, { origin: "http://localhost:8090", rpId: "localhost" })).token);

      // The browser offers the personal passkey on the console's page: the right relying party, origin and user handle.
      const offered = await staffAssertion(h, phone, personal.id, { counter: 1 });
      const err = await failure(signInVerify(h.deps, { response: offered }, { ...h.ctx, requestId: "req-personal" }));
      expect([err.code, err.status]).toEqual(["staff_key_invalid", 401]);
      expect(await sessionsOf(account.user.id)).toEqual([]);
      const [stored] = await migrateDb.select().from(passkeys).where(eq(passkeys.credentialId, personal.id));
      expect(stored).toMatchObject({ counter: 0, lastUsedAt: null, suspectAt: null });
      // The account's staff key opens the console there.
      expect((await signInKey(h, securityKey, staff.credentialId)).me.role).toBe("moderator");
    });
  });
});
```

### Replace `apps/api/test/integration/staff-step-up.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { stepUpActionHash, type AuthenticationResponseJSON } from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, staffKeys, staffSessions, users, type Db } from "@korbat/db";
import { AuthError } from "../../src/auth/context";
import { MINUTE } from "../../src/auth/limits";
import { challengeKey, issueChallenge, issueStepUpChallenge, readChallenge, readStepUpChallenge } from "../../src/auth/passkeys/challenge";
import { LateConfirmation, createAuthRepo, revokeConfirmedIn, type AuthRepo } from "../../src/auth/repo";
import { revokeStaffSession, stepUpOptions, verifyStepUp } from "../../src/auth/staff/step-up";
import { loadConfig } from "../../src/config";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, type FlowHarness } from "./flow-harness";
import { enrolKey } from "./staff-enrolment";
import { TEST_CONSOLE, TEST_CONSOLE_RP_ID, issueEnrolment, newStaffAccount, rolledBack } from "./staff-fixtures";
import { revokeConfirmed, revokeRequest, signedIn, stepUpAssertion } from "./staff-step-up";

const APP_ORIGIN = "http://localhost:8081";
const NO_UV: SoftFlags = { up: true, uv: false, be: false, bs: false };
const SYNCABLE: SoftFlags = { up: true, uv: true, be: true, bs: false };
const SYNCED: SoftFlags = { up: true, uv: true, be: true, bs: true };
/** BS without BE: no authenticator may report it, and the library refuses it as malformed before the flow sees its flags. */
const BACKED_UP_ONLY: SoftFlags = { up: true, uv: true, be: false, bs: true };

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/** A response's signature with its last byte changed: the library's check fails, and nothing else about it does. */
function badSignature(response: AuthenticationResponseJSON): AuthenticationResponseJSON {
  const signature = Buffer.from(response.response.signature, "base64url");
  signature[signature.length - 1] = signature[signature.length - 1]! ^ 0xff;
  return { ...response, response: { ...response.response, signature: signature.toString("base64url") } };
}

/** The three members of an assertion the audit row stores. */
const stored = (response: AuthenticationResponseJSON) => ({
  authenticatorData: response.response.authenticatorData,
  clientDataJSON: response.response.clientDataJSON,
  signature: response.response.signature,
});

/**
 * The staff step-up through the auth module's flows on the real database (3a design, section 7, Step-up): the console at
 * http://console.localhost:8090 with the relying party console.localhost, the software authenticator, keys enrolled
 * through the enrolment flow and sessions opened by the sign-in flow. 3a's one confirmed action revokes a staff session.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: staff step-up", () => {
  let authDb: Db;
  let migrateDb: Db;
  let repo: AuthRepo;

  beforeAll(() => {
    authDb = createDb(loadConfig().DATABASE_URL_AUTH, { max: 4 });
    // The migrate role reads every row back; the test environment carries its URL.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 4 });
    repo = createAuthRepo(authDb);
  });
  afterAll(async () => {
    await Promise.all([closeDb(authDb), closeDb(migrateDb)]);
  });

  const harness = () => flowHarness(repo, { console: TEST_CONSOLE });
  const ctxOf = (h: FlowHarness) => ({ ...h.ctx, requestId: `req-${randomUUID()}` });
  const head = async () => (await migrateDb.select().from(auditHead))[0]!;
  const keyRow = async (id: string) => (await migrateDb.select().from(staffKeys).where(eq(staffKeys.id, id)))[0]!;
  const sessionRow = async (handle: string) => (await migrateDb.select().from(staffSessions).where(eq(staffSessions.handle, handle)))[0]!;
  const rowsAfter = (seq: number) => migrateDb.select().from(auditLog).where(gt(auditLog.chainSeq, seq)).orderBy(asc(auditLog.chainSeq));
  const eventsOf = (userId: string, type: "staff_session_revoked" | "staff_key_counter_regression") =>
    migrateDb
      .select({ metadata: authEvents.metadata, ipHash: authEvents.ipHash })
      .from(authEvents)
      .where(and(eq(authEvents.userId, userId), eq(authEvents.type, type)))
      .orderBy(asc(authEvents.id));

  /**
   * A live staff account holding one key enrolled through the flow, signed in twice with it: from session `a` the person
   * confirms, and `b` is the session they revoke.
   */
  async function twoSessions(h: FlowHarness) {
    const { user } = await newStaffAccount(authDb, repo);
    const auth = new SoftAuthenticator();
    const enrolled = await enrolKey(h, auth, (await issueEnrolment(migrateDb, user.id)).token);
    const a = await signedIn(h, auth, enrolled.credentialId, 1);
    const b = await signedIn(h, auth, enrolled.credentialId, 2);
    return { user, auth, keyId: enrolled.key.id, credentialId: enrolled.credentialId, a: a.session, b: b.session };
  }

  test("the options: the session's key alone, user verification required, the console's relying party, a 5-minute prompt and a step-up challenge bound to the session and the action", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const { options } = await stepUpOptions(h.deps, s.a, request);
    expect(options.rpId).toBe(TEST_CONSOLE_RP_ID);
    expect(options.allowCredentials).toEqual([{ id: s.credentialId, type: "public-key", transports: ["usb", "nfc"] }]);
    expect(options.userVerification).toBe("required");
    expect(options.timeout).toBe(5 * MINUTE);
    const key = challengeKey(h.deps.config.authHmacKey);
    const actionHash = await stepUpActionHash(request);
    const otherTarget = await stepUpActionHash(revokeRequest(s.a.handle));
    expect(() => readStepUpChallenge(key, options.challenge, h.clock.now(), s.a.handle, actionHash)).not.toThrow();
    // Bound to this session and this action: another session's handle or another target refuses it, as does every other ceremony.
    expect(() => readStepUpChallenge(key, options.challenge, h.clock.now(), s.b.handle, actionHash)).toThrow(AuthError);
    expect(() => readStepUpChallenge(key, options.challenge, h.clock.now(), s.a.handle, otherTarget)).toThrow(AuthError);
    expect(() => readChallenge(key, options.challenge, "staff_signin", h.clock.now())).toThrow(AuthError);
  });

  test("a confirmed revocation: the session revoked, the key's use recorded, staff_session_revoked and its audit row with the action's hash, params, key and assertion, last in one transaction; no mail", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    h.mailer.sent.length = 0;
    const before = await head();
    h.clock.advance(MINUTE);
    const now = h.clock.now();
    const { stepUp, confirmed, revoked, requestId } = await revokeConfirmed(h, s.auth, s.credentialId, s.a, s.b.handle, 3);
    expect(revoked).toBe(true);

    const actionHash = await stepUpActionHash(revokeRequest(s.b.handle));
    expect(confirmed).toEqual({
      action: "staff_session_revoked",
      target: { type: "staff_session", id: s.b.handle },
      params: {},
      actionHash,
      keyId: s.keyId,
      assertion: stored(stepUp),
      // The challenge's own expiry, by which the row must be in the chain.
      expiresAt: new Date(now.getTime() + 10 * MINUTE),
    });
    expect((await sessionRow(s.b.handle)).revokedAt).toEqual(now);
    expect((await sessionRow(s.a.handle)).revokedAt).toBeNull();
    expect(await keyRow(s.keyId)).toMatchObject({ counter: 3, lastUsedAt: now, revokedAt: null, suspectAt: null });

    // The event names the session revoked and the one that revoked it; the row the account, both sessions and the key,
    // with what audit-verify checks: the action's hash, the params and the assertion exactly as the browser sent it.
    expect(await eventsOf(s.user.id, "staff_session_revoked")).toEqual([{ metadata: { handle: s.b.handle, by: s.a.handle }, ipHash: h.ctx.ipHash }]);
    const written = await rowsAfter(before.seq);
    expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.staffSession, r.keyId, r.actionHash, r.stepUp, r.metadata, r.requestId])).toEqual([
      ["staff_session_revoked", s.user.id, "staff_session", s.b.handle, s.a.handle, s.keyId, actionHash, stored(stepUp), { params: {} }, requestId],
    ]);
    // One transaction: the revoked session, the event and the audit row, which its last statement wrote.
    const [rows] = await migrateDb.execute<{ session: string; event: string; audit: string; sessionCmin: string; eventCmin: string; auditCmin: string }>(sql`select
      (select xmin::text from auth.staff_sessions where handle = ${s.b.handle}) as session,
      (select xmin::text from auth.auth_events where user_id = ${s.user.id} and type = 'staff_session_revoked') as event,
      (select xmin::text from public.audit_log where id = ${written[0]!.id}) as audit,
      (select cmin::text from auth.staff_sessions where handle = ${s.b.handle}) as "sessionCmin",
      (select cmin::text from auth.auth_events where user_id = ${s.user.id} and type = 'staff_session_revoked') as "eventCmin",
      (select cmin::text from public.audit_log where id = ${written[0]!.id}) as "auditCmin"`);
    expect(new Set([rows!.session, rows!.event, rows!.audit]).size).toBe(1);
    expect(Number(rows!.auditCmin)).toBeGreaterThan(Math.max(Number(rows!.sessionCmin), Number(rows!.eventCmin)));
    // The person did it themselves, with their key: nobody is mailed.
    expect(h.mailer.sent).toEqual([]);
  });

  test("bound to its action and target: an assertion given to revoke one session confirms no other revocation, nor the same one from another session", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const c = await signedIn(h, s.auth, s.credentialId, 3);
    const forB = await stepUpAssertion(h, s.auth, s.credentialId, s.a, revokeRequest(s.b.handle), { counter: 4 });
    for (const [label, session, handle] of [
      ["another target", s.a, c.session.handle],
      ["another session", c.session, s.b.handle],
    ] as const) {
      const err = await failure(verifyStepUp(h.deps, session, revokeRequest(handle), forB, ctxOf(h)));
      expect([label, err.code, err.status]).toEqual([label, "staff_step_up_invalid", 403]);
    }
    expect((await sessionRow(c.session.handle)).revokedAt).toBeNull();
    expect((await keyRow(s.keyId)).counter).toBe(3);
    // Refused on its binding, before it was spent: it still confirms what it was given for, and only that.
    const confirmed = await verifyStepUp(h.deps, s.a, revokeRequest(s.b.handle), forB, ctxOf(h));
    expect(await revokeStaffSession(h.deps, s.a, confirmed, ctxOf(h))).toBe(true);
    expect((await sessionRow(s.b.handle)).revokedAt).not.toBeNull();
    expect((await sessionRow(c.session.handle)).revokedAt).toBeNull();
  });

  test("single use: a confirmation is spent by its first use, and of two at once exactly one passes", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const once = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
    await verifyStepUp(h.deps, s.a, request, once, ctxOf(h));
    const again = await failure(verifyStepUp(h.deps, s.a, request, once, ctxOf(h)));
    expect([again.code, again.status]).toEqual(["staff_step_up_invalid", 403]);

    const twice = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 4 });
    const results = await Promise.allSettled([verifyStepUp(h.deps, s.a, request, twice, ctxOf(h)), verifyStepUp(h.deps, s.a, request, twice, ctxOf(h))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.map((r) => (r.reason as AuthError).code)).toEqual(["staff_step_up_invalid"]);
  });

  test("a confirmation read with less than a minute of its ten left is challenge_expired and confirms nothing, so its row is never written after its expiry", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    for (const age of [9 * MINUTE, 10 * MINUTE]) {
      const late = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
      h.clock.advance(age);
      const err = await failure(verifyStepUp(h.deps, s.a, request, late, ctxOf(h)));
      expect([age, err.code, err.status]).toEqual([age, "challenge_expired", 400]);
    }
    expect((await keyRow(s.keyId)).counter).toBe(2);
    expect((await sessionRow(s.b.handle)).revokedAt).toBeNull();
  });

  test("a confirmation whose challenge has expired by the database's clock when its transaction opens is challenge_expired before any statement runs, and nothing is revoked or written", { timeout: 30_000 }, async () => {
    // The API's clock is ten minutes behind, so the challenge is read with all its life left, but by the database's clock,
    // which stamps the row, it expired two seconds ago: the lock bound finds nothing left, and the transaction stops there.
    // audit-verify would refuse a row written now for good.
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    h.clock.advance(-(10 * MINUTE + 2_000));
    const at = (await head()).seq;
    const stepUp = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
    const confirmed = await verifyStepUp(h.deps, s.a, request, stepUp, ctxOf(h));
    const err = await failure(revokeStaffSession(h.deps, s.a, confirmed, ctxOf(h)));
    expect([err.code, err.status]).toEqual(["challenge_expired", 400]);
    expect((await sessionRow(s.b.handle)).revokedAt).toBeNull();
    expect(await eventsOf(s.user.id, "staff_session_revoked")).toEqual([]);
    expect(await rowsAfter(at)).toEqual([]);
  });

  test("the statement that writes a confirmed row checks the database's clock: a row that joined the chain at or after its challenge's expiry is undone with everything before it", { timeout: 30_000 }, async () => {
    // The revocation's statements without the lock bound that opens their transaction, as if each wait had ended just
    // inside it and the waits together had outlasted the challenge, which expired two seconds ago by the database's clock.
    // Only the check in the audit row's own statement is left to stop the row. Each run is a savepoint, as
    // revokeConfirmedStaffSession's transaction is, inside a transaction that ends in a rollback, so a row audit-verify
    // would refuse is never committed, whatever the outcome.
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    h.clock.advance(-(10 * MINUTE + 2_000));
    const at = (await head()).seq;
    const stepUp = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
    const confirmed = await verifyStepUp(h.deps, s.a, request, stepUp, ctxOf(h));
    const input = {
      userId: s.user.id,
      staffSession: s.a.handle,
      keyId: confirmed.keyId,
      handle: s.b.handle,
      actionHash: confirmed.actionHash,
      params: confirmed.params,
      stepUp: confirmed.assertion,
      now: h.clock.now(),
      ipHash: h.ctx.ipHash,
      requestId: `req-${randomUUID()}`,
    };
    let late: unknown;
    let afterLate: { revokedAt: Date | null; events: number } | undefined;
    let inTime: unknown;
    await rolledBack(authDb, async (tx) => {
      late = await tx.transaction((sp) => revokeConfirmedIn(sp, { ...input, expiresAt: confirmed.expiresAt })).then(
        (outcome) => outcome,
        (err: unknown) => err,
      );
      // What the late run did before its row (the session revoked, the event) went with it.
      const [session] = await tx.select({ revokedAt: staffSessions.revokedAt }).from(staffSessions).where(eq(staffSessions.handle, s.b.handle));
      const events = await tx.select({ id: authEvents.id }).from(authEvents).where(and(eq(authEvents.userId, s.user.id), eq(authEvents.type, "staff_session_revoked")));
      afterLate = { revokedAt: session!.revokedAt, events: events.length };
      // The same statements with the challenge's life still ahead write: the late row was refused for its time alone.
      inTime = await tx.transaction((sp) => revokeConfirmedIn(sp, { ...input, expiresAt: new Date(Date.now() + 10 * MINUTE) }));
    });
    expect(late).toBeInstanceOf(LateConfirmation);
    expect(afterLate).toEqual({ revokedAt: null, events: 0 });
    expect(inTime).toBe("revoked");
    expect((await sessionRow(s.b.handle)).revokedAt).toBeNull();
    expect(await eventsOf(s.user.id, "staff_session_revoked")).toEqual([]);
    expect(await rowsAfter(at)).toEqual([]);
  });

  test("a confirmation stalled by a held audit head gives up before its challenge's expiry: challenge_expired, and nothing is revoked or written", { timeout: 30_000 }, async () => {
    // Four seconds of the challenge's life left by the database's clock, while another transaction holds the head, as one
    // left open after its audit insert would: the write waits for the head only a share of what is left, never past it.
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    h.clock.advance(-(10 * MINUTE - 4_000));
    const at = (await head()).seq;
    const stepUp = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
    const confirmed = await verifyStepUp(h.deps, s.a, request, stepUp, ctxOf(h));
    let outcome: Promise<unknown> = Promise.resolve();
    let gaveUpWhileHeld = false;
    await rolledBack(migrateDb, async (tx) => {
      await tx.execute(sql`select seq from public.audit_head for update`);
      outcome = revokeStaffSession(h.deps, s.a, confirmed, ctxOf(h)).then(
        () => "written",
        (err: unknown) => err,
      );
      // Released after eight seconds at most, so a write that waits on would still end (and be caught below).
      gaveUpWhileHeld = await Promise.race([outcome.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8_000))]);
    });
    const err = await outcome;
    expect(gaveUpWhileHeld).toBe(true);
    expect(err).toBeInstanceOf(AuthError);
    expect([(err as AuthError).code, (err as AuthError).status]).toEqual(["challenge_expired", 400]);
    expect((await sessionRow(s.b.handle)).revokedAt).toBeNull();
    expect(await rowsAfter(at)).toEqual([]);
  });

  test("only the session's own key confirms: the person's other key, another account's key, and the right key for the app's origin or relying party are staff_step_up_invalid", { timeout: 60_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const red = await enrolKey(h, s.auth, (await issueEnrolment(migrateDb, s.user.id)).token, { name: "Red key" });
    const other = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const fresh = async () => (await stepUpOptions(h.deps, s.a, request)).options.challenge;
    const signedBy = async (auth: SoftAuthenticator, credentialId: string, counter: number) =>
      auth.get({ credentialId, rpId: TEST_CONSOLE_RP_ID, challenge: await fresh(), origin: h.deps.config.console!.origin, flags: { up: true, uv: true, be: false, bs: false }, counter });
    const cases: [string, AuthenticationResponseJSON][] = [
      ["the person's other key", await signedBy(s.auth, red.credentialId, 1)],
      ["another account's key", await signedBy(other.auth, other.credentialId, 5)],
      ["the app's origin", await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3, origin: APP_ORIGIN })],
      ["the app's relying party", await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 4, rpId: "localhost" })],
      ["a bad signature", badSignature(await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 5 }))],
    ];
    for (const [label, response] of cases) {
      const err = await failure(verifyStepUp(h.deps, s.a, request, response, ctxOf(h)));
      expect([label, err.code, err.status]).toEqual([label, "staff_step_up_invalid", 403]);
    }
    expect((await keyRow(s.keyId)).counter).toBe(2);
    expect((await keyRow(red.key.id)).counter).toBe(0);
    expect((await keyRow(other.keyId)).counter).toBe(2);
    expect((await sessionRow(s.b.handle)).revokedAt).toBeNull();
  });

  test("a session opened before the console moved to another address with the same relying party ID confirms nothing there: staff_step_up_invalid at the options and at the confirmation, writing nothing", { timeout: 60_000 }, async () => {
    // Opened at port 8091 with a key enrolled there; the console then moved to 8090 and kept its relying party ID, and the
    // browser's staff cookies, which no port separates, still name the session. A confirmation made at the new address
    // would be a row audit-verify refuses for good, since it judges it against the origin recorded on the key.
    const MOVED_FROM = "http://console.localhost:8091";
    const before = flowHarness(repo, { console: { origin: MOVED_FROM, rpId: TEST_CONSOLE_RP_ID } });
    const { user } = await newStaffAccount(authDb, repo);
    const auth = new SoftAuthenticator();
    const enrolled = await enrolKey(before, auth, (await issueEnrolment(migrateDb, user.id, { origin: MOVED_FROM })).token);
    const a = (await signedIn(before, auth, enrolled.credentialId, 1)).session;
    const b = (await signedIn(before, auth, enrolled.credentialId, 2)).session;
    const request = revokeRequest(b.handle);
    const moved = harness();
    const at = (await head()).seq;

    const asked = await failure(stepUpOptions(moved.deps, a, request));
    expect([asked.code, asked.status]).toEqual(["staff_step_up_invalid", 403]);
    // Options from before the move (the sealing key is the same), signed by the key at the new address.
    const challenge = (await stepUpOptions(before.deps, a, request)).options.challenge;
    const stepUp = await stepUpAssertion(moved, auth, enrolled.credentialId, a, request, { counter: 3, challenge });
    const err = await failure(verifyStepUp(moved.deps, a, request, stepUp, ctxOf(moved)));
    expect([err.code, err.status]).toEqual(["staff_step_up_invalid", 403]);
    expect((await keyRow(enrolled.key.id)).counter).toBe(2);
    expect((await sessionRow(b.handle)).revokedAt).toBeNull();
    expect(await rowsAfter(at)).toEqual([]);
  });

  test("whatever the codec or the library refuses is staff_step_up_invalid, never a passkey code", { timeout: 60_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const key = challengeKey(h.deps.config.authHmacKey);
    const now = h.clock.now();
    const actionHash = await stepUpActionHash(request);
    const assert = (challenge: string, counter: number) => stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter, challenge });
    const used = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 });
    await verifyStepUp(h.deps, s.a, request, used, ctxOf(h));
    const spent = JSON.parse(Buffer.from(used.response.clientDataJSON, "base64url").toString()).challenge as string;

    const cases: [string, AuthenticationResponseJSON][] = [
      ["a spent challenge", await assert(spent, 4)],
      ["a step-up challenge for another session", await assert(issueStepUpChallenge(key, now, s.b.handle, actionHash), 5)],
      ["a step-up challenge sealed with another key", await assert(issueStepUpChallenge(challengeKey(Buffer.alloc(32, 9)), now, s.a.handle, actionHash), 6)],
      ["the app's sign-in challenge", await assert(issueChallenge(key, "signin", now), 7)],
      ["the app's re-authentication challenge for this session", await assert(issueChallenge(key, "reauth", now, s.a.handle), 8)],
      ["a staff sign-in challenge", await assert(issueChallenge(key, "staff_signin", now), 9)],
      ["a staff registration challenge", await assert(issueChallenge(key, "staff_register", now, randomUUID()), 10)],
      ["a forged challenge", await assert(randomBytes(74).toString("base64url"), 11)],
      ["not a challenge at all", await assert("x", 12)],
    ];
    for (const [label, response] of cases) {
      const err = await failure(verifyStepUp(h.deps, s.a, request, response, ctxOf(h)));
      expect([label, err.code, err.status]).toEqual([label, "staff_step_up_invalid", 403]);
      expect(err.code, label).not.toMatch(/^passkey_/);
    }
    // Only the one good confirmation moved the counter.
    expect((await keyRow(s.keyId)).counter).toBe(3);
  });

  test("after the signature, the flags: no UV is staff_key_not_user_verified, BE backed up or not staff_key_not_device_bound, and BS without BE staff_step_up_invalid; none moves the counter", { timeout: 30_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const request = revokeRequest(s.b.handle);
    const cases: [SoftFlags, string][] = [
      [NO_UV, "staff_key_not_user_verified"],
      [SYNCABLE, "staff_key_not_device_bound"],
      [SYNCED, "staff_key_not_device_bound"],
      [BACKED_UP_ONLY, "staff_step_up_invalid"],
    ];
    for (const [flags, code] of cases) {
      const response = await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 5, flags });
      const err = await failure(verifyStepUp(h.deps, s.a, request, response, ctxOf(h)));
      expect([JSON.stringify(flags), err.code, err.status]).toEqual([JSON.stringify(flags), code, 403]);
    }
    expect(await keyRow(s.keyId)).toMatchObject({ counter: 2, revokedAt: null });
    // The counter the refused assertions reported is still ahead of the stored one.
    expect((await revokeConfirmed(h, s.auth, s.credentialId, s.a, s.b.handle, 5)).revoked).toBe(true);
  });

  test("a counter that goes backwards at a step-up revokes the key and every staff session it opened, the confirming one included, records it with via step_up, mails staff_key_suspect and answers staff_key_suspended", { timeout: 60_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const red = await enrolKey(h, s.auth, (await issueEnrolment(migrateDb, s.user.id)).token, { name: "Red key" });
    const onRed = await signedIn(h, s.auth, red.credentialId, 1);
    h.mailer.sent.length = 0;
    const before = await head();
    h.clock.advance(MINUTE);
    const now = h.clock.now();
    const response = await stepUpAssertion(h, s.auth, s.credentialId, s.a, revokeRequest(s.b.handle), { counter: 2 });
    const err = await failure(verifyStepUp(h.deps, s.a, revokeRequest(s.b.handle), response, ctxOf(h)));
    expect([err.code, err.status]).toEqual(["staff_key_suspended", 403]);

    expect(await keyRow(s.keyId)).toMatchObject({ revokedAt: now, suspectAt: now, counter: 2 });
    expect(await keyRow(red.key.id)).toMatchObject({ revokedAt: null, suspectAt: null });
    expect((await sessionRow(s.a.handle)).revokedAt).toEqual(now);
    expect((await sessionRow(s.b.handle)).revokedAt).toEqual(now);
    expect((await sessionRow(onRed.session.handle)).revokedAt).toBeNull();
    expect((await eventsOf(s.user.id, "staff_key_counter_regression")).map((e) => e.metadata)).toEqual([{ keyId: s.keyId, sessionsRevoked: 2, via: "step_up" }]);
    // The regression's own row, and no revocation as asked: the action never ran.
    const written = await rowsAfter(before.seq);
    expect(written.map((r) => [r.action, r.actorId, r.targetType, r.targetId, r.metadata])).toEqual([
      ["staff_key_counter_regression", s.user.id, "staff_key", s.keyId, { keyId: s.keyId, sessionsRevoked: 2, via: "step_up" }],
    ]);
    expect(h.mailer.sent).toEqual([{ to: s.user.email, template: "staff_key_suspect", data: { name: "Blue key" } }]);
  });

  test("a key revoked or an account demoted between the confirmation and the action ends there: staff_session_required, and nothing is revoked or written", { timeout: 60_000 }, async () => {
    const h = harness();
    const enders: [string, (s: Awaited<ReturnType<typeof twoSessions>>) => Promise<unknown>][] = [
      ["the key revoked", (s) => authDb.update(staffKeys).set({ revokedAt: h.clock.now() }).where(eq(staffKeys.id, s.keyId))],
      ["the account demoted", (s) => authDb.update(users).set({ role: "user" }).where(eq(users.id, s.user.id))],
      ["the account deleted", (s) => authDb.update(users).set({ deletedAt: h.clock.now() }).where(eq(users.id, s.user.id))],
    ];
    for (const [label, end] of enders) {
      const s = await twoSessions(h);
      const request = revokeRequest(s.b.handle);
      const confirmed = await verifyStepUp(h.deps, s.a, request, await stepUpAssertion(h, s.auth, s.credentialId, s.a, request, { counter: 3 }), ctxOf(h));
      await end(s);
      const before = await head();
      const err = await failure(revokeStaffSession(h.deps, s.a, confirmed, ctxOf(h)));
      expect([label, err.code, err.status]).toEqual([label, "staff_session_required", 401]);
      expect((await sessionRow(s.b.handle)).revokedAt, label).toBeNull();
      expect(await head(), label).toEqual(before);
    }
  });

  test("a session that is not the person's own and live is not theirs to revoke: false, and nothing is changed or written", { timeout: 60_000 }, async () => {
    const h = harness();
    const s = await twoSessions(h);
    const other = await twoSessions(h);
    const before = await head();
    // A confirmation for another account's session verifies, since it names that handle, and revokes nothing.
    expect((await revokeConfirmed(h, s.auth, s.credentialId, s.a, other.b.handle, 3)).revoked).toBe(false);
    expect((await sessionRow(other.b.handle)).revokedAt).toBeNull();
    // Nor a handle no session has.
    expect((await revokeConfirmed(h, s.auth, s.credentialId, s.a, randomUUID(), 4)).revoked).toBe(false);
    // Nor one of the person's own that has already ended: its first end stays as it was.
    const ended = new Date(h.clock.ms() - MINUTE);
    await authDb.update(staffSessions).set({ revokedAt: ended }).where(eq(staffSessions.handle, s.b.handle));
    expect((await revokeConfirmed(h, s.auth, s.credentialId, s.a, s.b.handle, 5)).revoked).toBe(false);
    expect((await sessionRow(s.b.handle)).revokedAt).toEqual(ended);
    expect(await head()).toEqual(before);
    expect(await eventsOf(s.user.id, "staff_session_revoked")).toEqual([]);
  });
});
```

### Replace `apps/api/test/staff/route-table.test.ts` (whole file)

```ts
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { AuditEntry, AuditPage, StaffEnrollVerifyResponse, StaffKey, StaffKeysResponse, StaffMe, StaffSession, StaffSessionsResponse } from "@korbat/contracts";
import { createDb } from "@korbat/db";
import { createAccount } from "../../src/account";
import { createApp } from "../../src/app";
import { createAuth } from "../../src/auth";
import { MemoryKv } from "../../src/auth/kv";
import { loadConfig } from "../../src/config";
import { MemoryMailer } from "../../src/mail/memory";
import { createMedia } from "../../src/media";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createSocial } from "../../src/social";
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
  const staff = createStaff({ apiDb, auth: auth.forStaff });
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

/** A lower-case uuid, as a staff path's parameter (a session's handle) takes one. */
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
  test("are exactly the staff module's: the gate, sign-in, enrolment, the person's own reads, sign-out, step-up and the confirmed revocation", () => {
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
      ].sort(),
    );
  });

  test("hold no route of another module under /api/staff", () => {
    const { app, staffOwn } = build();
    expect(staffOwn.length).toBeGreaterThan(0);
    // Every staff path is probed, the ones the old fixed list left out among them.
    const probes = staffProbes(staffOwn);
    for (const p of ["/api/staff/audit", "/api/staff/keys", "/api/staff/signout", "/api/staff/signin/options", "/api/staff/signin/verify", "/api/staff/enroll/options", "/api/staff/enroll/verify", `/api/staff/sessions/${SAMPLE_PARAMETER}`]) {
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
    // The one path parameter under /api/staff is a staff session's handle, which the revocation takes only from the
    // person's own sessions (the step-up suites show another account's is not found).
    const parameters = distinct(app.routes.filter((r) => isStaffPath(r.path) && r.path.includes(":")));
    expect(parameters).toEqual(["DELETE /api/staff/sessions/:handle"]);
    const answers = { StaffMe, StaffSession, StaffKey, AuditEntry, StaffSessionsResponse, StaffKeysResponse, AuditPage, StaffEnrollVerifyResponse };
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
```

### Replace `packages/contracts/test/staff.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  AuditEntry,
  AuditPage,
  AuditPageQuery,
  AuthenticationResponseJSON,
  CEREMONY_CHALLENGE,
  CHALLENGE_PURPOSES,
  DisplayName,
  PasskeyOptionsResponse,
  STAFF_AUDIT_PAGE_SIZE,
  STAFF_STEP_UP_ACTIONS,
  STAFF_STEP_UP_CHALLENGE,
  StaffEnrollOptionsRequest,
  StaffEnrollOptionsResponse,
  StaffEnrollVerifyRequest,
  StaffEnrollVerifyResponse,
  StaffErrorCode,
  StaffKey,
  StaffKeyKind,
  StaffKeyName,
  StaffKeysResponse,
  StaffMe,
  StaffRole,
  StaffSession,
  StaffSessionRevokeRequest,
  StaffSessionsResponse,
  StaffSignInOptionsResponse,
  StaffSignInVerifyRequest,
  StaffSignInVerifyResponse,
  StaffStepUpActionName,
  StaffStepUpOptionsRequest,
  StaffStepUpOptionsResponse,
  StaffStoredAssertion,
  stepUpActionHash,
  stepUpActionText,
  stepUpBinding,
  stepUpBindingText,
} from "../src/index";

const BELL = String.fromCharCode(7);
/** U+202E, the right-to-left override: invisible, and refused by the display-name rules. */
const RLO = String.fromCharCode(0x202e);

/** A base64url string of exactly n characters. */
const b64 = (n: number) => "A".repeat(n);

const at = "2026-09-30T10:00:00.000Z";
const later = "2026-09-30T22:00:00.000Z";
const token = "a".repeat(43);
const uuid = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
const hex = "ab".repeat(32);

/** What @simplewebauthn/browser's startRegistration returns for a security key. */
const registration = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: b64(200), attestationObject: b64(400), transports: ["usb", "nfc"] },
  clientExtensionResults: {},
  authenticatorAttachment: "cross-platform",
};

/** What startAuthentication returns for a discoverable staff key: the user handle is there. */
const assertion = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: b64(200), authenticatorData: b64(50), signature: b64(96), userHandle: b64(43) },
  clientExtensionResults: {},
  authenticatorAttachment: "cross-platform",
};

const options = { challenge: b64(78), rpId: "console.korbat.example", allowCredentials: [], userVerification: "required", timeout: 300000 };

/** Every key of an object removed in turn must make the schema refuse it. */
function everyFieldRequired(schema: { safeParse: (value: unknown) => { success: boolean } }, value: Record<string, unknown>) {
  for (const key of Object.keys(value)) {
    const partial: Record<string, unknown> = { ...value };
    delete partial[key];
    expect(schema.safeParse(partial).success, key).toBe(false);
  }
}

describe("staff error codes", () => {
  test("are exactly the ten codes of the staff flows", () => {
    expect(StaffErrorCode.options).toEqual([
      "staff_session_required",
      "staff_key_invalid",
      "staff_key_suspended",
      "staff_key_limit",
      "staff_key_not_device_bound",
      "staff_key_not_user_verified",
      "staff_key_refused",
      "staff_enrollment_invalid",
      "staff_step_up_required",
      "staff_step_up_invalid",
    ]);
    expect(StaffErrorCode.safeParse("passkey_invalid").success).toBe(false);
  });
});

describe("staff roles, key names and kinds", () => {
  test("a staff role is moderator or admin, never user", () => {
    expect(StaffRole.options).toEqual(["moderator", "admin"]);
    expect(StaffRole.safeParse("user").success).toBe(false);
  });

  test("a key's name follows the display-name rules", () => {
    expect(StaffKeyName).toBe(DisplayName);
    expect(StaffKeyName.parse("  Blue key ")).toBe("Blue key");
    expect(StaffKeyName.safeParse("x".repeat(51)).success).toBe(false);
    expect(StaffKeyName.safeParse(`Blue${BELL}key`).success).toBe(false);
    expect(StaffKeyName.safeParse(`Blue${RLO}key`).success).toBe(false);
  });

  test("a key is a security key or this device", () => {
    expect(StaffKeyKind.options).toEqual(["security_key", "this_device"]);
    expect(StaffKeyKind.safeParse("platform").success).toBe(false);
  });
});

describe("enrolment", () => {
  test("options are asked for with the link's token, the key's name and its kind", () => {
    const request = { token, name: " Blue key ", kind: "security_key" };
    expect(StaffEnrollOptionsRequest.parse(request)).toEqual({ token, name: "Blue key", kind: "security_key" });
    expect(StaffEnrollOptionsRequest.parse({ ...request, kind: "this_device" }).kind).toBe("this_device");
    everyFieldRequired(StaffEnrollOptionsRequest, request);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, token: "a".repeat(42) }).success).toBe(false);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, token: `${"a".repeat(42)}=` }).success).toBe(false);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, name: "" }).success).toBe(false);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, kind: "passkey" }).success).toBe(false);
  });

  test("the options answer says whether the console's relying party ID is the app's", () => {
    const answer = { options: { ...options, rp: { id: "localhost", name: "korbat" } }, rpShared: true };
    expect(StaffEnrollOptionsResponse.parse(answer)).toEqual(answer);
    expect(StaffEnrollOptionsResponse.parse({ ...answer, rpShared: false }).rpShared).toBe(false);
    expect(StaffEnrollOptionsResponse.safeParse({ options: answer.options }).success).toBe(false);
    expect(StaffEnrollOptionsResponse.safeParse({ ...answer, rpShared: "no" }).success).toBe(false);
    expect(StaffEnrollOptionsResponse.safeParse({ ...answer, options: { challenge: "abc+/" } }).success).toBe(false);
  });

  test("verify takes the token, the name and a registration response, never an assertion", () => {
    const request = { token, name: "Blue key", response: registration };
    expect(StaffEnrollVerifyRequest.parse(request)).toEqual(request);
    everyFieldRequired(StaffEnrollVerifyRequest, request);
    expect(StaffEnrollVerifyRequest.safeParse({ ...request, response: assertion }).success).toBe(false);
    expect(StaffEnrollVerifyRequest.safeParse({ ...request, name: "x".repeat(51) }).success).toBe(false);
  });

  test("verify answers with the key it stored", () => {
    const key = { id: uuid, name: "Blue key", createdAt: at, lastUsedAt: null };
    expect(StaffEnrollVerifyResponse.parse({ key })).toEqual({ key });
    expect(StaffEnrollVerifyResponse.safeParse({}).success).toBe(false);
  });
});

describe("sign-in", () => {
  test("the options answer is the library's options with a base64url challenge", () => {
    expect(StaffSignInOptionsResponse).toBe(PasskeyOptionsResponse);
    expect(StaffSignInOptionsResponse.parse({ options })).toEqual({ options });
  });

  test("verify takes an assertion, never a registration", () => {
    expect(StaffSignInVerifyRequest.parse({ response: assertion })).toEqual({ response: assertion });
    expect(StaffSignInVerifyRequest.safeParse({ response: registration }).success).toBe(false);
    expect(StaffSignInVerifyRequest.safeParse({}).success).toBe(false);
  });

  test("verify answers with the new session, as /me describes it", () => {
    expect(StaffSignInVerifyResponse).toBe(StaffMe);
  });
});

describe("the staff account and its session", () => {
  const me = {
    handle: "mod_ada",
    role: "moderator",
    sessionHandle: uuid,
    idleExpiresAt: at,
    idleSecondsLeft: 900,
    absoluteExpiresAt: later,
    absoluteSecondsLeft: 43_200,
  };

  test("/me carries the handle, the role, the session's handle and both expiries with the seconds left", () => {
    expect(StaffMe.parse(me)).toEqual(me);
    expect(StaffMe.parse({ ...me, role: "admin", idleSecondsLeft: 0, absoluteSecondsLeft: 0 }).role).toBe("admin");
    everyFieldRequired(StaffMe, me);
  });

  test("/me refuses a user's role, a session handle that is not a uuid, and seconds that are negative or fractional", () => {
    expect(StaffMe.safeParse({ ...me, role: "user" }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, sessionHandle: "nope" }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, idleSecondsLeft: -1 }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, absoluteSecondsLeft: 1.5 }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, idleExpiresAt: "tonight" }).success).toBe(false);
  });

  test("the idle end never lies beyond the absolute end", () => {
    expect(StaffMe.safeParse({ ...me, idleSecondsLeft: 43_201 }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, idleSecondsLeft: 43_200 }).success).toBe(true);
  });

  test("a staff session is listed with its handle, browser, dates and whether it is this one", () => {
    const session = { handle: uuid, browser: "Firefox on Linux", createdAt: at, lastUsedAt: at, current: true };
    expect(StaffSession.parse(session)).toEqual(session);
    everyFieldRequired(StaffSession, session);
    expect(StaffSession.safeParse({ ...session, handle: "abc" }).success).toBe(false);
    expect(StaffSessionsResponse.parse({ sessions: [session] })).toEqual({ sessions: [session] });
    expect(StaffSessionsResponse.parse({ sessions: [] })).toEqual({ sessions: [] });
    expect(StaffSessionsResponse.safeParse({}).success).toBe(false);
  });

  test("a staff key is listed with its id, name and dates, never its public key", () => {
    const key = { id: uuid, name: "Blue key", createdAt: at, lastUsedAt: at };
    expect(StaffKey.parse(key)).toEqual(key);
    expect(StaffKey.parse({ ...key, lastUsedAt: null }).lastUsedAt).toBeNull();
    // A member the reader never sends is dropped, not passed on to the page.
    expect(StaffKey.parse({ ...key, publicKey: b64(100) })).toEqual(key);
    everyFieldRequired(StaffKey, key);
    expect(StaffKeysResponse.parse({ keys: [key] })).toEqual({ keys: [key] });
    expect(StaffKeysResponse.safeParse({ keys: [{ ...key, id: 7 }] }).success).toBe(false);
  });
});

describe("step-up actions", () => {
  test("3a has one: revoking a staff session, whose target is a staff session and whose params are empty", () => {
    expect(Object.keys(STAFF_STEP_UP_ACTIONS)).toEqual(["staff_session_revoked"]);
    expect(StaffStepUpActionName.options).toEqual(Object.keys(STAFF_STEP_UP_ACTIONS));
    const spec = STAFF_STEP_UP_ACTIONS.staff_session_revoked;
    expect(spec.targetType).toBe("staff_session");
    expect(spec.targetId.safeParse(uuid).success).toBe(true);
    expect(spec.targetId.safeParse("abc").success).toBe(false);
    // Only the lower-case spelling PostgreSQL writes: the id is hashed as sent, and the audit row records the database's.
    expect(spec.targetId.safeParse(uuid.toUpperCase()).success).toBe(false);
    expect(spec.targetId.safeParse(uuid.slice(0, 9) + uuid.slice(9).toUpperCase()).success).toBe(false);
    expect(spec.params.parse({})).toEqual({});
    // Params are hashed as they are sent, so a member the schema does not know is refused, never dropped.
    expect(spec.params.safeParse({ all: true }).success).toBe(false);
  });

  test("the options request names the action, its target and its params, each checked by that action's own schema", () => {
    const request = { action: "staff_session_revoked", target: { type: "staff_session", id: uuid }, params: {} };
    expect(StaffStepUpOptionsRequest.parse(request)).toEqual(request);
    everyFieldRequired(StaffStepUpOptionsRequest, request);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, action: "role_granted" }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_key", id: uuid } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_session", id: "abc" } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_session", id: uuid.toUpperCase() } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_session", id: uuid, extra: 1 } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, params: { all: true } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, stepUp: assertion }).success).toBe(false);
  });

  test("the options answer is the library's options", () => {
    expect(StaffStepUpOptionsResponse).toBe(PasskeyOptionsResponse);
    expect(StaffStepUpOptionsResponse.parse({ options: { ...options, allowCredentials: [{ id: b64(22), type: "public-key" }] } }).options.challenge).toBe(options.challenge);
  });

  test("revoking a session takes its params with the step-up assertion added", () => {
    expect(StaffSessionRevokeRequest.parse({ stepUp: assertion })).toEqual({ stepUp: assertion });
    expect(StaffSessionRevokeRequest.safeParse({}).success).toBe(false);
    expect(StaffSessionRevokeRequest.safeParse({ stepUp: registration }).success).toBe(false);
    expect(StaffSessionRevokeRequest.safeParse({ stepUp: assertion, all: true }).success).toBe(false);
  });

  test("the stored assertion is the authenticator data, client data and signature, bounded as the browser's answer is", () => {
    const stored = { authenticatorData: b64(50), clientDataJSON: b64(200), signature: b64(96) };
    expect(StaffStoredAssertion.parse(stored)).toEqual(stored);
    everyFieldRequired(StaffStoredAssertion, stored);
    expect(StaffStoredAssertion.shape.signature).toBe(AuthenticationResponseJSON.shape.response.shape.signature);
    expect(StaffStoredAssertion.safeParse({ ...stored, signature: b64(1025) }).success).toBe(false);
    expect(StaffStoredAssertion.safeParse({ ...stored, clientDataJSON: "ab/cd" }).success).toBe(false);
    expect(StaffStoredAssertion.safeParse({ ...stored, userHandle: b64(43) }).success).toBe(false);
  });
});

describe("the step-up action's hash and binding", () => {
  const BS = String.fromCharCode(92);
  const LF = String.fromCharCode(10);
  const revoke = { action: "staff_session_revoked", target: { type: "staff_session", id: uuid }, params: {} };
  // The 3a action's sorted JSON, and the sha256 values below, were checked with Python's hashlib when they were written.
  const REVOKE_TEXT = `{"action":"staff_session_revoked","params":{},"target":{"id":"${uuid}","type":"staff_session"}}`;
  const REVOKE_HASH = "dad06ce5248ff75b3aa9b1faec9bab38bfa70f6dd2568d231b02e282207385c5";
  const SESSION = "8a3c7f0e-1111-4222-8333-944445555666";
  const BINDING = "9b70fa1ab475e7958d1265150cd04c7953483fe6145f52b12b2fd89d0c598dca";
  const hexOf = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  test("the action's text is the sorted JSON of its action, target and params: object keys sorted, no whitespace", () => {
    expect(stepUpActionText(revoke)).toBe(REVOKE_TEXT);
    // The order the members were written in changes nothing.
    expect(stepUpActionText({ params: {}, target: { id: uuid, type: "staff_session" }, action: "staff_session_revoked" })).toBe(REVOKE_TEXT);
    // The options request is hashed as it was sent: its schemas change nothing in it.
    expect(stepUpActionText(StaffStepUpOptionsRequest.parse(revoke))).toBe(REVOKE_TEXT);
  });

  test("params are sorted at every depth, arrays keep their order, and strings and numbers are written as JSON.stringify writes them", () => {
    const params = { b: [3, { z: 1, a: null }, "x"], a: `q"${BS}`, c: true, d: 0.5, e: -0, "": -1, B: { y: [], x: {} } };
    expect(stepUpActionText({ action: "case_decided", target: { type: "post", id: "p1" }, params })).toBe(
      `{"action":"case_decided","params":{"":-1,"B":{"x":{},"y":[]},"a":"q${BS}"${BS}${BS}","b":[3,{"a":null,"z":1},"x"],"c":true,"d":0.5,"e":0},"target":{"id":"p1","type":"post"}}`,
    );
  });

  test("keys are sorted by UTF-16 code units, as Array.prototype.sort sorts them in the API, audit-verify and the console alike", () => {
    const eAcute = String.fromCharCode(0xe9);
    const fullwidthA = String.fromCharCode(0xff21);
    // An astral character's first code unit (0xd83d) sorts before 0xff21, though its code point (0x1f600) is higher.
    const grinning = String.fromCodePoint(0x1f600);
    const params = { [fullwidthA]: 1, [grinning]: 2, [eAcute]: 3, z: 4 };
    expect(stepUpActionText({ action: "a", target: { type: "t", id: "i" }, params })).toBe(
      `{"action":"a","params":{"z":4,"${eAcute}":3,"${grinning}":2,"${fullwidthA}":1},"target":{"id":"i","type":"t"}}`,
    );
  });

  test("a value that is not JSON is refused rather than hashed", () => {
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, () => 1, BigInt(1), new Date(0), [undefined], Symbol("x")]) {
      expect(() => stepUpActionText({ action: "a", target: { type: "t", id: "i" }, params: { value } }), String(typeof value)).toThrow(TypeError);
    }
  });

  test("the action's hash is the lower-case hex sha256 of the text's UTF-8 bytes", async () => {
    expect(await stepUpActionHash(revoke)).toBe(REVOKE_HASH);
    const reason = String.fromCharCode(0xe9, 0x4e2d) + String.fromCodePoint(0x1f600);
    expect(await stepUpActionHash({ action: "case_decided", target: { type: "post", id: "p1" }, params: { reason } })).toBe(
      "8f41483850c87296607ff1c3fd5e501574bcc3f564a09d935a7063efab414720",
    );
  });

  test("another action, target or params gives another hash: params are bound too, though 3a's one action has none", async () => {
    const hashes = await Promise.all([
      stepUpActionHash(revoke),
      stepUpActionHash({ ...revoke, action: "staff_key_revoked" }),
      stepUpActionHash({ ...revoke, target: { type: "staff_session", id: "4f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a" } }),
      stepUpActionHash({ ...revoke, target: { type: "staff_key", id: uuid } }),
      stepUpActionHash({ ...revoke, params: { all: true } }),
      stepUpActionHash({ ...revoke, params: { all: false } }),
      stepUpActionHash({ ...revoke, params: { items: [1, 2] } }),
      stepUpActionHash({ ...revoke, params: { items: [2, 1] } }),
    ]);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  test("the binding is the full 32-byte sha256 of the session's handle, a newline and the action's hash", async () => {
    expect(stepUpBindingText(SESSION, REVOKE_HASH)).toBe(`${SESSION}${LF}${REVOKE_HASH}`);
    const binding = await stepUpBinding(SESSION, REVOKE_HASH);
    expect(binding).toBeInstanceOf(Uint8Array);
    expect(binding).toHaveLength(32);
    expect(hexOf(binding)).toBe(BINDING);
    // Another session, or another action, binds something else.
    expect(hexOf(await stepUpBinding("7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36", REVOKE_HASH))).not.toBe(BINDING);
    expect(hexOf(await stepUpBinding(SESSION, "0".repeat(64)))).not.toBe(BINDING);
  });

  test("the step-up challenge's layout: 74 bytes of version, purpose, expiry, nonce, the full binding and the seal", () => {
    expect(STAFF_STEP_UP_CHALLENGE).toEqual({
      bytes: 74,
      encodedLength: 99,
      version: 1,
      purpose: 6,
      versionAt: 0,
      purposeAt: 1,
      expiryAt: 2,
      expiryBytes: 8,
      nonceAt: 10,
      nonceBytes: 16,
      bindingAt: 26,
      bindingBytes: 32,
      sealAt: 58,
      sealBytes: 16,
    });
    // The fields follow one another with no gap, and the encoded length is the bytes' unpadded base64url length.
    const c = STAFF_STEP_UP_CHALLENGE;
    expect([c.purposeAt + 1, c.expiryAt + c.expiryBytes, c.nonceAt + c.nonceBytes, c.bindingAt + c.bindingBytes, c.sealAt + c.sealBytes]).toEqual([
      c.expiryAt,
      c.nonceAt,
      c.bindingAt,
      c.sealAt,
      c.bytes,
    ]);
    expect(c.encodedLength).toBe(Math.ceil((c.bytes * 8) / 6));
  });

  test("the other ceremonies' layout: 58 bytes of version, purpose, expiry, nonce, a 16-byte binding and the seal", () => {
    expect(CEREMONY_CHALLENGE).toEqual({
      bytes: 58,
      encodedLength: 78,
      version: 1,
      versionAt: 0,
      purposeAt: 1,
      expiryAt: 2,
      expiryBytes: 8,
      nonceAt: 10,
      nonceBytes: 16,
      bindingAt: 26,
      bindingBytes: 16,
      sealAt: 42,
      sealBytes: 16,
    });
    const c = CEREMONY_CHALLENGE;
    expect([c.purposeAt + 1, c.expiryAt + c.expiryBytes, c.nonceAt + c.nonceBytes, c.bindingAt + c.bindingBytes, c.sealAt + c.sealBytes]).toEqual([
      c.expiryAt,
      c.nonceAt,
      c.bindingAt,
      c.sealAt,
      c.bytes,
    ]);
    expect(c.encodedLength).toBe(Math.ceil((c.bytes * 8) / 6));
    // The two layouts share their first fields, and their lengths keep either from being read as the other.
    expect([c.versionAt, c.purposeAt, c.expiryAt, c.nonceAt, c.bindingAt, c.version]).toEqual([
      STAFF_STEP_UP_CHALLENGE.versionAt,
      STAFF_STEP_UP_CHALLENGE.purposeAt,
      STAFF_STEP_UP_CHALLENGE.expiryAt,
      STAFF_STEP_UP_CHALLENGE.nonceAt,
      STAFF_STEP_UP_CHALLENGE.bindingAt,
      STAFF_STEP_UP_CHALLENGE.version,
    ]);
    expect(c.bytes).not.toBe(STAFF_STEP_UP_CHALLENGE.bytes);
  });

  test("each ceremony's purpose code, the step-up's among them, and no two alike", () => {
    expect(CHALLENGE_PURPOSES).toEqual({ signin: 1, register: 2, reauth: 3, staff_signin: 4, staff_register: 5, staff_step_up: 6 });
    expect(STAFF_STEP_UP_CHALLENGE.purpose).toBe(CHALLENGE_PURPOSES.staff_step_up);
    expect(new Set(Object.values(CHALLENGE_PURPOSES)).size).toBe(Object.keys(CHALLENGE_PURPOSES).length);
  });
});

describe("the audit log", () => {
  const entry = {
    seq: 42,
    hash: hex,
    createdAt: at,
    actorHandle: "mod_ada",
    action: "staff_session_revoked",
    targetType: "staff_session",
    targetId: uuid,
    actionHash: "cd".repeat(32),
  };

  test("an entry carries its place and hash, time, actor handle, action, target and the action's hash", () => {
    expect(AuditEntry.parse(entry)).toEqual(entry);
    // The system actor has no handle; most rows have no step-up, some no target.
    const bare = { ...entry, actorHandle: null, targetType: null, targetId: null, actionHash: null };
    expect(AuditEntry.parse(bare)).toEqual(bare);
    everyFieldRequired(AuditEntry, entry);
  });

  test("an entry never carries metadata, and its place and hashes have their exact forms", () => {
    expect(AuditEntry.parse({ ...entry, metadata: { email: "a@b.c" } })).toEqual(entry);
    for (const seq of [0, -1, 1.5, "42"]) expect(AuditEntry.safeParse({ ...entry, seq }).success, String(seq)).toBe(false);
    for (const hash of ["AB".repeat(32), "ab".repeat(31), `${"ab".repeat(31)}zz`]) {
      expect(AuditEntry.safeParse({ ...entry, hash }).success, hash).toBe(false);
      expect(AuditEntry.safeParse({ ...entry, actionHash: hash }).success, hash).toBe(false);
    }
  });

  test("a page holds at most 50 entries and the cursor of the next one, null at the end", () => {
    expect(STAFF_AUDIT_PAGE_SIZE).toBe(50);
    expect(AuditPage.parse({ entries: [entry], nextCursor: 42 })).toEqual({ entries: [entry], nextCursor: 42 });
    expect(AuditPage.parse({ entries: [], nextCursor: null })).toEqual({ entries: [], nextCursor: null });
    expect(AuditPage.safeParse({ entries: Array(51).fill(entry), nextCursor: null }).success).toBe(false);
    expect(AuditPage.safeParse({ entries: Array(50).fill(entry), nextCursor: 1 }).success).toBe(true);
    expect(AuditPage.safeParse({ entries: [entry] }).success).toBe(false);
    expect(AuditPage.safeParse({ entries: [entry], nextCursor: 0 }).success).toBe(false);
  });

  test("a page is asked for by cursor, by place (at) or from the newest, with sign-ins as the one filter", () => {
    expect(AuditPageQuery.parse({})).toEqual({});
    expect(AuditPageQuery.parse({ cursor: "42" })).toEqual({ cursor: 42 });
    expect(AuditPageQuery.parse({ at: "7", action: "staff_sign_in" })).toEqual({ at: 7, action: "staff_sign_in" });
    expect(AuditPageQuery.parse({ cursor: "999999999999999" }).cursor).toBe(999_999_999_999_999);
    for (const value of ["0", "-1", "1.5", "01", "1e3", "", " 4", "abc", "1000000000000000"]) {
      expect(AuditPageQuery.safeParse({ cursor: value }).success, value).toBe(false);
      expect(AuditPageQuery.safeParse({ at: value }).success, value).toBe(false);
    }
    expect(AuditPageQuery.safeParse({ action: "role_granted" }).success).toBe(false);
    // A cursor reads older rows and at reads from a place: both at once name no page.
    expect(AuditPageQuery.safeParse({ cursor: "4", at: "7" }).success).toBe(false);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/db test:       Tests  40 passed (40)
packages/contracts test:  ❯ test/staff.test.ts (35 tests | 2 failed) 60ms
packages/contracts test:  Test Files  1 failed | 7 passed (8)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/staff-console-3a/write_blocks.py docs/superpowers/prompts/staff-console-3a/08-review-fixes.md 3
```

Expected: 25 lines starting with `wrote`, one for each file below.

### Create `apps/admin/src/challenge.ts`

```ts
import { CEREMONY_CHALLENGE, CHALLENGE_PURPOSES } from "@korbat/contracts";
import { messageFor } from "./messages";
import { fromBase64url } from "./webauthn";

/**
 * The console's check of a sign-in's and an enrolment's challenge before it asks for the key (3a design, section 9). An
 * API under an attacker's control could otherwise hand the sign-in a step-up challenge for an action of its choosing: the
 * key would sign it at an ordinary sign-in, and the assertion would pass audit-verify as a confirmation of that action.
 * So the challenge must be the contracts' 58-byte layout, version 1, with the purpose of exactly this ceremony; a step-up
 * challenge is 74 bytes with a purpose of its own, so it can never pass. The step-up's own check is in step-up.ts.
 */

/** Options whose challenge is not one of this ceremony's; the key was not asked. */
export class CeremonyMismatch extends Error {
  readonly status = 0;
  constructor(readonly code: "signin_mismatch" | "enroll_mismatch") {
    super(messageFor(code));
    this.name = "CeremonyMismatch";
  }
}

/**
 * The challenge's bytes when it is the 58-byte layout of version 1 with `purpose`, or null. It is decoded by the same
 * function that turns it into the bytes the browser hands the key, so the bytes checked are the bytes signed.
 */
function ceremonyBytes(challenge: unknown, purpose: "staff_signin" | "staff_register"): Uint8Array | null {
  if (typeof challenge !== "string") return null;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64url(challenge);
  } catch {
    return null;
  }
  const c = CEREMONY_CHALLENGE;
  if (bytes.length !== c.bytes || bytes[c.versionAt] !== c.version || bytes[c.purposeAt] !== CHALLENGE_PURPOSES[purpose]) return null;
  return bytes;
}

/** A staff sign-in's challenge: the 58-byte layout with the staff_signin purpose, bound to nothing, so its binding is zeros. */
export function checkSignInChallenge(options: { challenge?: unknown }): void {
  const bytes = ceremonyBytes(options.challenge, "staff_signin");
  const c = CEREMONY_CHALLENGE;
  if (!bytes || !bytes.subarray(c.bindingAt, c.bindingAt + c.bindingBytes).every((byte) => byte === 0)) throw new CeremonyMismatch("signin_mismatch");
}

/**
 * A staff registration's challenge: the 58-byte layout with the staff_register purpose. Its binding is the first 16 bytes
 * of the sha256 of the enrolment's id, which the page is never told, so the API alone checks it.
 */
export function checkRegisterChallenge(options: { challenge?: unknown }): void {
  if (!ceremonyBytes(options.challenge, "staff_register")) throw new CeremonyMismatch("enroll_mismatch");
}
```

### Create `apps/admin/src/sign-in.ts`

```ts
import type { StaffMe } from "@korbat/contracts";
import type { StaffApi } from "./api";
import { checkSignInChallenge } from "./challenge";
import { authenticationResponseToJSON, ceremonyFailure, fromBase64url, requestOptionsFromJSON, type CredentialsLike } from "./webauthn";

/**
 * A staff sign-in as the console runs it (3a design, sections 7 and 9): options, the check of their challenge, the
 * browser's prompt, then the verify, which opens a session whatever session the browser held before. Every request is
 * marked: the person pressed a button, though no session may exist yet to move.
 *
 * `onlyCredential` (the base64url id of a credential) narrows the browser's prompt to that one key, whatever the options
 * listed: the enrolment's success page signs in with the key just registered, so the check after each enrolment proves
 * that key opens the console and never passes on an older key the browser chose instead.
 */
export async function signInWithKey(deps: { api: StaffApi; credentials: CredentialsLike }, onlyCredential?: string): Promise<StaffMe> {
  const { options } = await deps.api.signInOptions({ activity: true });
  // Before the key is asked: a challenge that is not a staff sign-in's is never signed.
  checkSignInChallenge(options);
  const publicKey = requestOptionsFromJSON(options);
  if (onlyCredential !== undefined) publicKey.allowCredentials = [{ id: fromBase64url(onlyCredential), type: "public-key" }];
  let credential: unknown;
  try {
    credential = await deps.credentials.get({ publicKey });
  } catch (err) {
    throw ceremonyFailure(err);
  }
  return deps.api.signInVerify({ response: authenticationResponseToJSON(credential) }, { activity: true });
}
```

### Create `packages/db/migrations/0013_forget_revoked_staff_keys.sql`

```sql
-- The take-down's last word on its staff keys (3a design, section 6), now blanking only keys that are already revoked.
-- korbat_auth may set and clear auth.users.deleted_at, so the account's mark alone let it blank a live account's keys
-- (mark it deleted, call this, clear the mark): the name, AAGUID and transports its column grants keep it from changing,
-- which staff.js keys and the runbook rely on. It can revoke a key but never undo that (the never-cleared trigger), so a
-- key it can blank is one it has already ended for good, which gives it nothing it cannot already do. The take-down
-- revokes every key earlier in the same transaction, so it still blanks them all. Every key keeps what audit-verify needs
-- (its id, owner, credential id, public key, origin and relying party ID), its counter and its dates. Returns how many
-- keys it blanked. CREATE OR REPLACE keeps the function's owner and its grants; they are stated again all the same.
CREATE OR REPLACE FUNCTION "auth"."forget_staff_keys"(user_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, pg_temp AS $$
DECLARE
  forgotten integer;
BEGIN
  UPDATE auth.staff_keys k SET name = '', aaguid = NULL, transports = '{}'::text[]
   WHERE k.user_id = forget_staff_keys.user_id
     AND k.revoked_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = forget_staff_keys.user_id AND u.deleted_at IS NOT NULL);
  GET DIAGNOSTICS forgotten = ROW_COUNT;
  RETURN forgotten;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "auth"."forget_staff_keys"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "auth"."forget_staff_keys"(uuid) TO korbat_auth;
```

### Create `packages/db/migrations/meta/0013_snapshot.json`

```json
{
  "id": "fd8f0c6a-241b-4a31-a2e3-dc304f104d38",
  "prevId": "dfae6382-75f0-4044-9a2e-deb6e3fb9f7e",
  "version": "7",
  "dialect": "postgresql",
  "tables": {
    "auth.auth_events": {
      "name": "auth_events",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigserial",
          "primaryKey": true,
          "notNull": true
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "type": {
          "name": "type",
          "type": "auth_event_type",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true
        },
        "device_id": {
          "name": "device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "metadata": {
          "name": "metadata",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "auth_events_user_created_idx": {
          "name": "auth_events_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "auth_events_user_id_users_id_fk": {
          "name": "auth_events_user_id_users_id_fk",
          "tableFrom": "auth_events",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "auth_events_auth_insert": {
          "name": "auth_events_auth_insert",
          "as": "PERMISSIVE",
          "for": "INSERT",
          "to": [
            "korbat_auth"
          ],
          "withCheck": "true"
        },
        "auth_events_auth_select": {
          "name": "auth_events_auth_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_auth"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.devices": {
      "name": "devices",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "device_hash": {
          "name": "device_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "label": {
          "name": "label",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "platform": {
          "name": "platform",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "first_seen_at": {
          "name": "first_seen_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_seen_at": {
          "name": "last_seen_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "devices_user_idx": {
          "name": "devices_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "devices_ip_hash_idx": {
          "name": "devices_ip_hash_idx",
          "columns": [
            {
              "expression": "ip_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "devices_user_id_users_id_fk": {
          "name": "devices_user_id_users_id_fk",
          "tableFrom": "devices",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "devices_auth_all": {
          "name": "devices_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.email_codes": {
      "name": "email_codes",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "email": {
          "name": "email",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "code_hash": {
          "name": "code_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "purpose": {
          "name": "purpose",
          "type": "email_code_purpose",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "attempts": {
          "name": "attempts",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "consumed_at": {
          "name": "consumed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "flow_id": {
          "name": "flow_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "ip_hash": {
          "name": "ip_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "email_codes_email_idx": {
          "name": "email_codes_email_idx",
          "columns": [
            {
              "expression": "email",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "email_codes_flow_idx": {
          "name": "email_codes_flow_idx",
          "columns": [
            {
              "expression": "flow_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "email_codes_user_id_users_id_fk": {
          "name": "email_codes_user_id_users_id_fk",
          "tableFrom": "email_codes",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "email_codes_auth_all": {
          "name": "email_codes_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.passkeys": {
      "name": "passkeys",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "credential_id": {
          "name": "credential_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "public_key": {
          "name": "public_key",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "counter": {
          "name": "counter",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "transports": {
          "name": "transports",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "backed_up": {
          "name": "backed_up",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "name": {
          "name": "name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "aaguid": {
          "name": "aaguid",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "backup_eligible": {
          "name": "backup_eligible",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "uv_initialized": {
          "name": "uv_initialized",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "created_device_id": {
          "name": "created_device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "suspect_at": {
          "name": "suspect_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "passkeys_credential_idx": {
          "name": "passkeys_credential_idx",
          "columns": [
            {
              "expression": "credential_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "passkeys_user_idx": {
          "name": "passkeys_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "passkeys_user_id_users_id_fk": {
          "name": "passkeys_user_id_users_id_fk",
          "tableFrom": "passkeys",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "passkeys_created_device_id_devices_id_fk": {
          "name": "passkeys_created_device_id_devices_id_fk",
          "tableFrom": "passkeys",
          "columnsFrom": [
            "created_device_id"
          ],
          "tableTo": "devices",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "passkeys_auth_all": {
          "name": "passkeys_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.sessions": {
      "name": "sessions",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "device_id": {
          "name": "device_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "absolute_expires_at": {
          "name": "absolute_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "reauth_at": {
          "name": "reauth_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "handle": {
          "name": "handle",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "factors": {
          "name": "factors",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "passkey_id": {
          "name": "passkey_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "sessions_user_idx": {
          "name": "sessions_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "sessions_handle_idx": {
          "name": "sessions_handle_idx",
          "columns": [
            {
              "expression": "handle",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "sessions_user_id_users_id_fk": {
          "name": "sessions_user_id_users_id_fk",
          "tableFrom": "sessions",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "sessions_device_id_devices_id_fk": {
          "name": "sessions_device_id_devices_id_fk",
          "tableFrom": "sessions",
          "columnsFrom": [
            "device_id"
          ],
          "tableTo": "devices",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "sessions_passkey_id_passkeys_id_fk": {
          "name": "sessions_passkey_id_passkeys_id_fk",
          "tableFrom": "sessions",
          "columnsFrom": [
            "passkey_id"
          ],
          "tableTo": "passkeys",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "sessions_auth_all": {
          "name": "sessions_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.staff_enrollments": {
      "name": "staff_enrollments",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "token_hash": {
          "name": "token_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "origin": {
          "name": "origin",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "rp_id": {
          "name": "rp_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "used_at": {
          "name": "used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "staff_enrollments_token_hash_idx": {
          "name": "staff_enrollments_token_hash_idx",
          "columns": [
            {
              "expression": "token_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "staff_enrollments_user_idx": {
          "name": "staff_enrollments_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "staff_enrollments_user_id_users_id_fk": {
          "name": "staff_enrollments_user_id_users_id_fk",
          "tableFrom": "staff_enrollments",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "staff_enrollments_auth_all": {
          "name": "staff_enrollments_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "auth.staff_keys": {
      "name": "staff_keys",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "credential_id": {
          "name": "credential_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "public_key": {
          "name": "public_key",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "counter": {
          "name": "counter",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "transports": {
          "name": "transports",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "name": {
          "name": "name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "aaguid": {
          "name": "aaguid",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "origin": {
          "name": "origin",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "rp_id": {
          "name": "rp_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "suspect_at": {
          "name": "suspect_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "staff_keys_credential_idx": {
          "name": "staff_keys_credential_idx",
          "columns": [
            {
              "expression": "credential_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "staff_keys_user_idx": {
          "name": "staff_keys_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "staff_keys_user_id_users_id_fk": {
          "name": "staff_keys_user_id_users_id_fk",
          "tableFrom": "staff_keys",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "restrict"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {
        "staff_keys_id_user_id_unique": {
          "name": "staff_keys_id_user_id_unique",
          "columns": [
            "id",
            "user_id"
          ],
          "nullsNotDistinct": false
        }
      },
      "policies": {
        "staff_keys_auth_all": {
          "name": "staff_keys_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "staff_keys_suspect_is_revoked": {
          "name": "staff_keys_suspect_is_revoked",
          "value": "\"auth\".\"staff_keys\".\"suspect_at\" is null or \"auth\".\"staff_keys\".\"revoked_at\" is not null"
        }
      },
      "isRLSEnabled": true
    },
    "auth.staff_sessions": {
      "name": "staff_sessions",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "handle": {
          "name": "handle",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "key_id": {
          "name": "key_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "last_used_at": {
          "name": "last_used_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "idle_expires_at": {
          "name": "idle_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "absolute_expires_at": {
          "name": "absolute_expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "revoked_at": {
          "name": "revoked_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "browser": {
          "name": "browser",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "staff_sessions_handle_idx": {
          "name": "staff_sessions_handle_idx",
          "columns": [
            {
              "expression": "handle",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "staff_sessions_user_idx": {
          "name": "staff_sessions_user_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "staff_sessions_user_id_users_id_fk": {
          "name": "staff_sessions_user_id_users_id_fk",
          "tableFrom": "staff_sessions",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "users",
          "schemaTo": "auth",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "staff_sessions_key_user_fk": {
          "name": "staff_sessions_key_user_fk",
          "tableFrom": "staff_sessions",
          "columnsFrom": [
            "key_id",
            "user_id"
          ],
          "tableTo": "staff_keys",
          "schemaTo": "auth",
          "columnsTo": [
            "id",
            "user_id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "staff_sessions_auth_all": {
          "name": "staff_sessions_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "staff_sessions_lifetime": {
          "name": "staff_sessions_lifetime",
          "value": "\"auth\".\"staff_sessions\".\"absolute_expires_at\" <= \"auth\".\"staff_sessions\".\"created_at\" + interval '12 hours' and \"auth\".\"staff_sessions\".\"idle_expires_at\" <= \"auth\".\"staff_sessions\".\"absolute_expires_at\""
        }
      },
      "isRLSEnabled": true
    },
    "auth.users": {
      "name": "users",
      "schema": "auth",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "email": {
          "name": "email",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "email_verified_at": {
          "name": "email_verified_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "phone_hash": {
          "name": "phone_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "password_hash": {
          "name": "password_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "totp_secret_enc": {
          "name": "totp_secret_enc",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "totp_enabled_at": {
          "name": "totp_enabled_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "recovery_codes_hash": {
          "name": "recovery_codes_hash",
          "type": "text[]",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::text[]"
        },
        "failed_logins": {
          "name": "failed_logins",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "locked_until": {
          "name": "locked_until",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "role": {
          "name": "role",
          "type": "user_role",
          "typeSchema": "auth",
          "primaryKey": false,
          "notNull": true,
          "default": "'user'"
        },
        "age_confirmed_at": {
          "name": "age_confirmed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "terms_version": {
          "name": "terms_version",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "terms_accepted_at": {
          "name": "terms_accepted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "onboarded_at": {
          "name": "onboarded_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "password_changed_at": {
          "name": "password_changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "totp_last_step": {
          "name": "totp_last_step",
          "type": "bigint",
          "primaryKey": false,
          "notNull": false
        },
        "purged_at": {
          "name": "purged_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "webauthn_user_id": {
          "name": "webauthn_user_id",
          "type": "bytea",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "users_email_lower_idx": {
          "name": "users_email_lower_idx",
          "columns": [
            {
              "expression": "lower(\"email\")",
              "isExpression": true,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "users_phone_hash_idx": {
          "name": "users_phone_hash_idx",
          "columns": [
            {
              "expression": "phone_hash",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "where": "phone_hash is not null",
          "concurrently": false
        },
        "users_webauthn_user_id_idx": {
          "name": "users_webauthn_user_id_idx",
          "columns": [
            {
              "expression": "webauthn_user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "where": "webauthn_user_id is not null",
          "concurrently": false
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "users_auth_all": {
          "name": "users_auth_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_auth"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.handle_history": {
      "name": "handle_history",
      "schema": "",
      "columns": {
        "handle_lower": {
          "name": "handle_lower",
          "type": "text",
          "primaryKey": true,
          "notNull": true
        },
        "profile_id": {
          "name": "profile_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "changed_at": {
          "name": "changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {},
      "foreignKeys": {
        "handle_history_profile_id_profiles_id_fk": {
          "name": "handle_history_profile_id_profiles_id_fk",
          "tableFrom": "handle_history",
          "columnsFrom": [
            "profile_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "handle_history_api_all": {
          "name": "handle_history_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.profiles": {
      "name": "profiles",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true
        },
        "handle": {
          "name": "handle",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "display_name": {
          "name": "display_name",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "bio": {
          "name": "bio",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "avatar_path": {
          "name": "avatar_path",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "verified_at": {
          "name": "verified_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "reputation": {
          "name": "reputation",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "follower_count": {
          "name": "follower_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "following_count": {
          "name": "following_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "post_count": {
          "name": "post_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "handle_changed_at": {
          "name": "handle_changed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        },
        "show_in_explore": {
          "name": "show_in_explore",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": true
        }
      },
      "indexes": {
        "profiles_handle_lower_idx": {
          "name": "profiles_handle_lower_idx",
          "columns": [
            {
              "expression": "lower(\"handle\")",
              "isExpression": true,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "profiles_api_all": {
          "name": "profiles_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "profiles_counts_nonnegative": {
          "name": "profiles_counts_nonnegative",
          "value": "\"profiles\".\"follower_count\" >= 0 and \"profiles\".\"following_count\" >= 0 and \"profiles\".\"post_count\" >= 0"
        }
      },
      "isRLSEnabled": true
    },
    "public.blocks": {
      "name": "blocks",
      "schema": "",
      "columns": {
        "blocker_id": {
          "name": "blocker_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "blocked_id": {
          "name": "blocked_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "blocks_to_created_idx": {
          "name": "blocks_to_created_idx",
          "columns": [
            {
              "expression": "blocked_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "blocker_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "blocks_from_created_idx": {
          "name": "blocks_from_created_idx",
          "columns": [
            {
              "expression": "blocker_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "blocked_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "blocks_blocker_id_profiles_id_fk": {
          "name": "blocks_blocker_id_profiles_id_fk",
          "tableFrom": "blocks",
          "columnsFrom": [
            "blocker_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "blocks_blocked_id_profiles_id_fk": {
          "name": "blocks_blocked_id_profiles_id_fk",
          "tableFrom": "blocks",
          "columnsFrom": [
            "blocked_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {
        "blocks_blocker_id_blocked_id_pk": {
          "name": "blocks_blocker_id_blocked_id_pk",
          "columns": [
            "blocker_id",
            "blocked_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "blocks_api_all": {
          "name": "blocks_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "blocks_not_self": {
          "name": "blocks_not_self",
          "value": "\"blocks\".\"blocker_id\" <> \"blocks\".\"blocked_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.bookmarks": {
      "name": "bookmarks",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "bookmarks_post_idx": {
          "name": "bookmarks_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "bookmarks_user_created_idx": {
          "name": "bookmarks_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "bookmarks_user_id_profiles_id_fk": {
          "name": "bookmarks_user_id_profiles_id_fk",
          "tableFrom": "bookmarks",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "bookmarks_post_id_posts_id_fk": {
          "name": "bookmarks_post_id_posts_id_fk",
          "tableFrom": "bookmarks",
          "columnsFrom": [
            "post_id"
          ],
          "tableTo": "posts",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {
        "bookmarks_user_id_post_id_pk": {
          "name": "bookmarks_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "bookmarks_api_all": {
          "name": "bookmarks_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.explore_items": {
      "name": "explore_items",
      "schema": "",
      "columns": {
        "generation": {
          "name": "generation",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "position": {
          "name": "position",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "author_id": {
          "name": "author_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "explore_items_generation_post_idx": {
          "name": "explore_items_generation_post_idx",
          "columns": [
            {
              "expression": "generation",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "explore_items_generation_explore_runs_generation_fk": {
          "name": "explore_items_generation_explore_runs_generation_fk",
          "tableFrom": "explore_items",
          "columnsFrom": [
            "generation"
          ],
          "tableTo": "explore_runs",
          "columnsTo": [
            "generation"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "explore_items_post_id_posts_id_fk": {
          "name": "explore_items_post_id_posts_id_fk",
          "tableFrom": "explore_items",
          "columnsFrom": [
            "post_id"
          ],
          "tableTo": "posts",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "explore_items_author_id_profiles_id_fk": {
          "name": "explore_items_author_id_profiles_id_fk",
          "tableFrom": "explore_items",
          "columnsFrom": [
            "author_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {
        "explore_items_generation_position_pk": {
          "name": "explore_items_generation_position_pk",
          "columns": [
            "generation",
            "position"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "explore_items_api_all": {
          "name": "explore_items_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.explore_runs": {
      "name": "explore_runs",
      "schema": "",
      "columns": {
        "generation": {
          "name": "generation",
          "type": "integer",
          "primaryKey": true,
          "notNull": true,
          "identity": {
            "name": "explore_runs_generation_seq",
            "increment": "1",
            "minValue": "1",
            "maxValue": "2147483647",
            "startWith": "1",
            "cache": "1",
            "cycle": false,
            "schema": "public",
            "type": "always"
          }
        },
        "as_of": {
          "name": "as_of",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "formula": {
          "name": "formula",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true
        },
        "candidates": {
          "name": "candidates",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "items": {
          "name": "items",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        },
        "took_ms": {
          "name": "took_ms",
          "type": "integer",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "explore_runs_api_all": {
          "name": "explore_runs_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.follows": {
      "name": "follows",
      "schema": "",
      "columns": {
        "follower_id": {
          "name": "follower_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "followee_id": {
          "name": "followee_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "follows_to_created_idx": {
          "name": "follows_to_created_idx",
          "columns": [
            {
              "expression": "followee_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "follower_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "follows_from_created_idx": {
          "name": "follows_from_created_idx",
          "columns": [
            {
              "expression": "follower_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "followee_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "follows_follower_id_profiles_id_fk": {
          "name": "follows_follower_id_profiles_id_fk",
          "tableFrom": "follows",
          "columnsFrom": [
            "follower_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "follows_followee_id_profiles_id_fk": {
          "name": "follows_followee_id_profiles_id_fk",
          "tableFrom": "follows",
          "columnsFrom": [
            "followee_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {
        "follows_follower_id_followee_id_pk": {
          "name": "follows_follower_id_followee_id_pk",
          "columns": [
            "follower_id",
            "followee_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "follows_api_all": {
          "name": "follows_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "follows_not_self": {
          "name": "follows_not_self",
          "value": "\"follows\".\"follower_id\" <> \"follows\".\"followee_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.likes": {
      "name": "likes",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "likes_post_idx": {
          "name": "likes_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "likes_user_created_idx": {
          "name": "likes_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "likes_created_brin": {
          "name": "likes_created_brin",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "brin",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "likes_user_id_profiles_id_fk": {
          "name": "likes_user_id_profiles_id_fk",
          "tableFrom": "likes",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "likes_post_id_posts_id_fk": {
          "name": "likes_post_id_posts_id_fk",
          "tableFrom": "likes",
          "columnsFrom": [
            "post_id"
          ],
          "tableTo": "posts",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {
        "likes_user_id_post_id_pk": {
          "name": "likes_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "likes_api_all": {
          "name": "likes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.mutes": {
      "name": "mutes",
      "schema": "",
      "columns": {
        "muter_id": {
          "name": "muter_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "muted_id": {
          "name": "muted_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "mutes_to_created_idx": {
          "name": "mutes_to_created_idx",
          "columns": [
            {
              "expression": "muted_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "muter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "mutes_from_created_idx": {
          "name": "mutes_from_created_idx",
          "columns": [
            {
              "expression": "muter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "muted_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "mutes_muter_id_profiles_id_fk": {
          "name": "mutes_muter_id_profiles_id_fk",
          "tableFrom": "mutes",
          "columnsFrom": [
            "muter_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "mutes_muted_id_profiles_id_fk": {
          "name": "mutes_muted_id_profiles_id_fk",
          "tableFrom": "mutes",
          "columnsFrom": [
            "muted_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {
        "mutes_muter_id_muted_id_pk": {
          "name": "mutes_muter_id_muted_id_pk",
          "columns": [
            "muter_id",
            "muted_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "mutes_api_all": {
          "name": "mutes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "mutes_not_self": {
          "name": "mutes_not_self",
          "value": "\"mutes\".\"muter_id\" <> \"mutes\".\"muted_id\""
        }
      },
      "isRLSEnabled": true
    },
    "public.post_media": {
      "name": "post_media",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "owner_id": {
          "name": "owner_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "status": {
          "name": "status",
          "type": "media_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'processing'"
        },
        "error": {
          "name": "error",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "position": {
          "name": "position",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "width": {
          "name": "width",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "height": {
          "name": "height",
          "type": "integer",
          "primaryKey": false,
          "notNull": false
        },
        "blurhash": {
          "name": "blurhash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "alt_text": {
          "name": "alt_text",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "nsfw_score": {
          "name": "nsfw_score",
          "type": "real",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "post_media_post_position_idx": {
          "name": "post_media_post_position_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "position",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "post_media_owner_created_idx": {
          "name": "post_media_owner_created_idx",
          "columns": [
            {
              "expression": "owner_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "post_media_status_created_idx": {
          "name": "post_media_status_created_idx",
          "columns": [
            {
              "expression": "status",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "post_media_owner_id_profiles_id_fk": {
          "name": "post_media_owner_id_profiles_id_fk",
          "tableFrom": "post_media",
          "columnsFrom": [
            "owner_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "post_media_post_id_posts_id_fk": {
          "name": "post_media_post_id_posts_id_fk",
          "tableFrom": "post_media",
          "columnsFrom": [
            "post_id"
          ],
          "tableTo": "posts",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "post_media_api_all": {
          "name": "post_media_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "post_media_ready_has_dims": {
          "name": "post_media_ready_has_dims",
          "value": "\"post_media\".\"status\" <> 'ready' or (\"post_media\".\"width\" is not null and \"post_media\".\"height\" is not null and \"post_media\".\"blurhash\" is not null)"
        },
        "post_media_attached_is_complete": {
          "name": "post_media_attached_is_complete",
          "value": "\"post_media\".\"post_id\" is null or (\"post_media\".\"status\" = 'ready' and \"post_media\".\"position\" between 0 and 3 and \"post_media\".\"alt_text\" is not null)"
        },
        "post_media_alt_len": {
          "name": "post_media_alt_len",
          "value": "char_length(\"post_media\".\"alt_text\") <= 1000"
        }
      },
      "isRLSEnabled": true
    },
    "public.posts": {
      "name": "posts",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "author_id": {
          "name": "author_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "body": {
          "name": "body",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "reply_to_id": {
          "name": "reply_to_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "quote_of_id": {
          "name": "quote_of_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "state": {
          "name": "state",
          "type": "post_state",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'visible'"
        },
        "like_count": {
          "name": "like_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "repost_count": {
          "name": "repost_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "reply_count": {
          "name": "reply_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "quote_count": {
          "name": "quote_count",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "deleted_at": {
          "name": "deleted_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "posts_author_created_idx": {
          "name": "posts_author_created_idx",
          "columns": [
            {
              "expression": "author_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "posts_created_id_idx": {
          "name": "posts_created_id_idx",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "posts_reply_to_created_idx": {
          "name": "posts_reply_to_created_idx",
          "columns": [
            {
              "expression": "reply_to_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "posts_latest_idx": {
          "name": "posts_latest_idx",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "where": "reply_to_id is null and state = 'visible'",
          "concurrently": false
        },
        "posts_quote_of_idx": {
          "name": "posts_quote_of_idx",
          "columns": [
            {
              "expression": "quote_of_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "posts_author_id_profiles_id_fk": {
          "name": "posts_author_id_profiles_id_fk",
          "tableFrom": "posts",
          "columnsFrom": [
            "author_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "posts_reply_to_id_posts_id_fk": {
          "name": "posts_reply_to_id_posts_id_fk",
          "tableFrom": "posts",
          "columnsFrom": [
            "reply_to_id"
          ],
          "tableTo": "posts",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        },
        "posts_quote_of_id_posts_id_fk": {
          "name": "posts_quote_of_id_posts_id_fk",
          "tableFrom": "posts",
          "columnsFrom": [
            "quote_of_id"
          ],
          "tableTo": "posts",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "posts_api_all": {
          "name": "posts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {
        "posts_body_len": {
          "name": "posts_body_len",
          "value": "char_length(\"posts\".\"body\") <= 1000"
        },
        "posts_counts_nonnegative": {
          "name": "posts_counts_nonnegative",
          "value": "\"posts\".\"like_count\" >= 0 and \"posts\".\"repost_count\" >= 0 and \"posts\".\"reply_count\" >= 0 and \"posts\".\"quote_count\" >= 0"
        }
      },
      "isRLSEnabled": true
    },
    "public.reposts": {
      "name": "reposts",
      "schema": "",
      "columns": {
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "post_id": {
          "name": "post_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "reposts_post_idx": {
          "name": "reposts_post_idx",
          "columns": [
            {
              "expression": "post_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "reposts_user_created_idx": {
          "name": "reposts_user_created_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "reposts_created_brin": {
          "name": "reposts_created_brin",
          "columns": [
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "brin",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "reposts_user_id_profiles_id_fk": {
          "name": "reposts_user_id_profiles_id_fk",
          "tableFrom": "reposts",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "reposts_post_id_posts_id_fk": {
          "name": "reposts_post_id_posts_id_fk",
          "tableFrom": "reposts",
          "columnsFrom": [
            "post_id"
          ],
          "tableTo": "posts",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {
        "reposts_user_id_post_id_pk": {
          "name": "reposts_user_id_post_id_pk",
          "columns": [
            "user_id",
            "post_id"
          ]
        }
      },
      "uniqueConstraints": {},
      "policies": {
        "reposts_api_all": {
          "name": "reposts_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.appeals": {
      "name": "appeals",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "statement": {
          "name": "statement",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "status": {
          "name": "status",
          "type": "appeal_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'open'"
        },
        "reviewer_id": {
          "name": "reviewer_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "decision_reason": {
          "name": "decision_reason",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "decided_at": {
          "name": "decided_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "appeals_case_idx": {
          "name": "appeals_case_idx",
          "columns": [
            {
              "expression": "case_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "appeals_case_id_cases_id_fk": {
          "name": "appeals_case_id_cases_id_fk",
          "tableFrom": "appeals",
          "columnsFrom": [
            "case_id"
          ],
          "tableTo": "cases",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "appeals_reviewer_id_profiles_id_fk": {
          "name": "appeals_reviewer_id_profiles_id_fk",
          "tableFrom": "appeals",
          "columnsFrom": [
            "reviewer_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "appeals_api_all": {
          "name": "appeals_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.audit_head": {
      "name": "audit_head",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "smallint",
          "primaryKey": true,
          "notNull": true
        },
        "seq": {
          "name": "seq",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true
        },
        "hash": {
          "name": "hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "audit_head_api_select": {
          "name": "audit_head_api_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_api"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {
        "audit_head_single_row": {
          "name": "audit_head_single_row",
          "value": "\"audit_head\".\"id\" = 1"
        }
      },
      "isRLSEnabled": true
    },
    "public.audit_log": {
      "name": "audit_log",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "bigserial",
          "primaryKey": true,
          "notNull": true
        },
        "actor_id": {
          "name": "actor_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "action": {
          "name": "action",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "target_id": {
          "name": "target_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "metadata": {
          "name": "metadata",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": true,
          "default": "'{}'::jsonb"
        },
        "request_id": {
          "name": "request_id",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "staff_session": {
          "name": "staff_session",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "key_id": {
          "name": "key_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "action_hash": {
          "name": "action_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": false
        },
        "step_up": {
          "name": "step_up",
          "type": "jsonb",
          "primaryKey": false,
          "notNull": false
        },
        "chain_version": {
          "name": "chain_version",
          "type": "smallint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "chain_seq": {
          "name": "chain_seq",
          "type": "bigint",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "prev_hash": {
          "name": "prev_hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "hash": {
          "name": "hash",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        }
      },
      "indexes": {
        "audit_log_chain_seq_idx": {
          "name": "audit_log_chain_seq_idx",
          "columns": [
            {
              "expression": "chain_seq",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "audit_log_api_insert": {
          "name": "audit_log_api_insert",
          "as": "PERMISSIVE",
          "for": "INSERT",
          "to": [
            "korbat_api"
          ],
          "withCheck": "true"
        },
        "audit_log_api_select": {
          "name": "audit_log_api_select",
          "as": "PERMISSIVE",
          "for": "SELECT",
          "to": [
            "korbat_api"
          ],
          "using": "true"
        }
      },
      "checkConstraints": {
        "audit_log_step_up_complete": {
          "name": "audit_log_step_up_complete",
          "value": "(\"audit_log\".\"action_hash\" is null) = (\"audit_log\".\"step_up\" is null) and (\"audit_log\".\"action_hash\" is null or \"audit_log\".\"key_id\" is not null)"
        }
      },
      "isRLSEnabled": true
    },
    "public.cases": {
      "name": "cases",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "target_type": {
          "name": "target_type",
          "type": "target_type",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_id": {
          "name": "target_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "rule_id": {
          "name": "rule_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "action": {
          "name": "action",
          "type": "case_action",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'none'"
        },
        "public_reason": {
          "name": "public_reason",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "moderator_id": {
          "name": "moderator_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "senior": {
          "name": "senior",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "brigading_flag": {
          "name": "brigading_flag",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "weight": {
          "name": "weight",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 0
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "closed_at": {
          "name": "closed_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": false
        }
      },
      "indexes": {
        "cases_open_idx": {
          "name": "cases_open_idx",
          "columns": [
            {
              "expression": "closed_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "weight",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "created_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "cases_target_idx": {
          "name": "cases_target_idx",
          "columns": [
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "cases_moderator_id_profiles_id_fk": {
          "name": "cases_moderator_id_profiles_id_fk",
          "tableFrom": "cases",
          "columnsFrom": [
            "moderator_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "cases_api_all": {
          "name": "cases_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.reports": {
      "name": "reports",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "reporter_id": {
          "name": "reporter_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "target_type",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_id": {
          "name": "target_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "rule_id": {
          "name": "rule_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "details": {
          "name": "details",
          "type": "text",
          "primaryKey": false,
          "notNull": true,
          "default": "''"
        },
        "weight": {
          "name": "weight",
          "type": "integer",
          "primaryKey": false,
          "notNull": true,
          "default": 1
        },
        "status": {
          "name": "status",
          "type": "report_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true,
          "default": "'open'"
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "reports_reporter_target_idx": {
          "name": "reports_reporter_target_idx",
          "columns": [
            {
              "expression": "reporter_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": true,
          "with": {},
          "method": "btree",
          "concurrently": false
        },
        "reports_target_idx": {
          "name": "reports_target_idx",
          "columns": [
            {
              "expression": "target_type",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "target_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "reports_reporter_id_profiles_id_fk": {
          "name": "reports_reporter_id_profiles_id_fk",
          "tableFrom": "reports",
          "columnsFrom": [
            "reporter_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "reports_case_id_cases_id_fk": {
          "name": "reports_case_id_cases_id_fk",
          "tableFrom": "reports",
          "columnsFrom": [
            "case_id"
          ],
          "tableTo": "cases",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "set null"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "reports_api_all": {
          "name": "reports_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.strikes": {
      "name": "strikes",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "user_id": {
          "name": "user_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "case_id": {
          "name": "case_id",
          "type": "uuid",
          "primaryKey": false,
          "notNull": true
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        },
        "expires_at": {
          "name": "expires_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        }
      },
      "indexes": {
        "strikes_user_active_idx": {
          "name": "strikes_user_active_idx",
          "columns": [
            {
              "expression": "user_id",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            },
            {
              "expression": "expires_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {
        "strikes_user_id_profiles_id_fk": {
          "name": "strikes_user_id_profiles_id_fk",
          "tableFrom": "strikes",
          "columnsFrom": [
            "user_id"
          ],
          "tableTo": "profiles",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        },
        "strikes_case_id_cases_id_fk": {
          "name": "strikes_case_id_cases_id_fk",
          "tableFrom": "strikes",
          "columnsFrom": [
            "case_id"
          ],
          "tableTo": "cases",
          "columnsTo": [
            "id"
          ],
          "onUpdate": "no action",
          "onDelete": "cascade"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "strikes_api_all": {
          "name": "strikes_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    },
    "public.transparency_log": {
      "name": "transparency_log",
      "schema": "",
      "columns": {
        "id": {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "notNull": true,
          "default": "gen_random_uuid()"
        },
        "rule_id": {
          "name": "rule_id",
          "type": "text",
          "primaryKey": false,
          "notNull": true
        },
        "action": {
          "name": "action",
          "type": "case_action",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "target_type": {
          "name": "target_type",
          "type": "target_type",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": true
        },
        "decided_at": {
          "name": "decided_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true
        },
        "appealed": {
          "name": "appealed",
          "type": "boolean",
          "primaryKey": false,
          "notNull": true,
          "default": false
        },
        "appeal_outcome": {
          "name": "appeal_outcome",
          "type": "appeal_status",
          "typeSchema": "public",
          "primaryKey": false,
          "notNull": false
        },
        "created_at": {
          "name": "created_at",
          "type": "timestamp with time zone",
          "primaryKey": false,
          "notNull": true,
          "default": "now()"
        }
      },
      "indexes": {
        "transparency_decided_idx": {
          "name": "transparency_decided_idx",
          "columns": [
            {
              "expression": "decided_at",
              "isExpression": false,
              "asc": true,
              "nulls": "last"
            }
          ],
          "isUnique": false,
          "with": {},
          "method": "btree",
          "concurrently": false
        }
      },
      "foreignKeys": {},
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {
        "transparency_api_all": {
          "name": "transparency_api_all",
          "as": "PERMISSIVE",
          "for": "ALL",
          "to": [
            "korbat_api"
          ],
          "using": "true",
          "withCheck": "true"
        }
      },
      "checkConstraints": {},
      "isRLSEnabled": true
    }
  },
  "enums": {
    "auth.auth_event_type": {
      "name": "auth_event_type",
      "schema": "auth",
      "values": [
        "signup",
        "signin_success",
        "signin_failure",
        "mfa_enabled",
        "mfa_disabled",
        "recovery_code_used",
        "recovery_codes_regenerated",
        "password_set",
        "password_changed",
        "session_revoked",
        "sessions_revoked_all",
        "account_locked",
        "new_device",
        "not_me",
        "profile_updated",
        "handle_changed",
        "email_changed",
        "badge_verified",
        "badge_removed",
        "export_created",
        "account_deleted",
        "passkey_added",
        "passkey_removed",
        "passkey_counter_regression",
        "staff_enrollment_issued",
        "staff_key_added",
        "staff_key_revoked",
        "staff_key_counter_regression",
        "staff_sign_in",
        "staff_signed_out",
        "staff_session_revoked"
      ]
    },
    "auth.email_code_purpose": {
      "name": "email_code_purpose",
      "schema": "auth",
      "values": [
        "signup",
        "login",
        "change_email",
        "recovery",
        "reauth",
        "delete_account"
      ]
    },
    "auth.user_role": {
      "name": "user_role",
      "schema": "auth",
      "values": [
        "user",
        "moderator",
        "admin"
      ]
    },
    "public.media_status": {
      "name": "media_status",
      "schema": "public",
      "values": [
        "processing",
        "ready",
        "failed"
      ]
    },
    "public.post_state": {
      "name": "post_state",
      "schema": "public",
      "values": [
        "visible",
        "withheld",
        "removed",
        "deleted_by_author"
      ]
    },
    "public.appeal_status": {
      "name": "appeal_status",
      "schema": "public",
      "values": [
        "open",
        "upheld",
        "denied"
      ]
    },
    "public.case_action": {
      "name": "case_action",
      "schema": "public",
      "values": [
        "none",
        "withhold",
        "remove",
        "strike",
        "suspend"
      ]
    },
    "public.report_status": {
      "name": "report_status",
      "schema": "public",
      "values": [
        "open",
        "merged",
        "closed"
      ]
    },
    "public.target_type": {
      "name": "target_type",
      "schema": "public",
      "values": [
        "post",
        "profile"
      ]
    }
  },
  "schemas": {
    "auth": "auth"
  },
  "views": {},
  "sequences": {},
  "roles": {},
  "policies": {},
  "_meta": {
    "columns": {},
    "schemas": {},
    "tables": {}
  }
}
```

### Replace `apps/admin/src/api.ts` (whole file)

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
  /**
   * Every /me answer, marked or not: the session the browser's cookie names now, which the store keeps, so a page whose
   * cookie another tab replaced (a sign-out and a sign-in there) holds the new session's handle and binds step-ups to it.
   */
  onMe(me: StaffMe): void;
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
  const hooks: ApiHooks = { onSessionRequired: () => undefined, onActivity: () => undefined, onMe: () => undefined };

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
    me: async (call: Call = {}) => {
      const me = await request("GET", "/api/staff/me", StaffMe, call);
      hooks.onMe(me);
      return me;
    },
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

### Replace `apps/admin/src/audit-log.ts` (whole file)

```ts
import { AuditPageQuery, type AuditEntry, type AuditPage } from "@korbat/contracts";
import type { StaffApi } from "./api";
import { describeError } from "./messages";
import type { Loadable } from "./ui";

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

export type AuditReader = ReturnType<typeof createAuditReader>;

/** What the audit page shows: every row read so far, newest first, and how it was opened. */
export interface AuditPageView {
  page: Loadable<AuditEntry[]>;
  /** The place to read older rows from, or null when there are none (or while a page loads). */
  cursor: number | null;
  /** The place the page was opened at with Go to place, or null for the newest rows. */
  at: number | null;
  loadingOlder: boolean;
  /** A Load older that failed, in the console's words; the rows already read stay. */
  error: string | null;
}

export const AUDIT_PAGE_LOADING: AuditPageView = { page: { state: "loading" }, cursor: null, at: null, loadingOlder: false, error: null };

/**
 * The audit page's reads, each answer shown only on the page it was asked for. Opening a page (the newest, or Go to place)
 * starts a new generation, and an answer of an older generation is dropped: a Load older still in flight when the keeper
 * opens another page would otherwise append its rows to that page, under a heading that names another place, with rows
 * read twice. `show` receives every change; `stop` drops whatever is still in flight once the screen has gone.
 */
export function createAuditPager(reader: AuditReader, show: (view: AuditPageView) => void) {
  let view = AUDIT_PAGE_LOADING;
  let generation = 0;
  const update = (next: Partial<AuditPageView>) => {
    view = { ...view, ...next };
    show(view);
  };

  async function open(read: () => Promise<AuditPage>, at: number | null): Promise<void> {
    const mine = ++generation;
    // Nothing older can be asked for until this page has arrived, and a Load older of the page left is over.
    update({ page: { state: "loading" }, cursor: null, loadingOlder: false, error: null });
    try {
      const answer = await read();
      if (mine !== generation) return;
      update({ page: { state: "ready", value: answer.entries }, cursor: answer.nextCursor, at });
    } catch (err) {
      if (mine === generation) update({ page: { state: "failed", message: describeError(err) } });
    }
  }

  return {
    newest: () => open(reader.newest, null),
    at: (place: number) => open(() => reader.at(place), place),
    async older(): Promise<void> {
      const { cursor, page } = view;
      if (cursor === null || view.loadingOlder || page.state !== "ready") return;
      const mine = generation;
      update({ loadingOlder: true, error: null });
      try {
        const answer = await reader.older(cursor);
        if (mine !== generation) return;
        const shown = view.page.state === "ready" ? view.page.value : [];
        update({ page: { state: "ready", value: [...shown, ...answer.entries] }, cursor: answer.nextCursor, loadingOlder: false });
      } catch (err) {
        if (mine === generation) update({ error: describeError(err), loadingOlder: false });
      }
    },
    stop(): void {
      generation++;
    },
  };
}
```

### Replace `apps/admin/src/enroll.ts` (whole file)

```ts
import type { StaffEnrollOptionsRequest, StaffKey } from "@korbat/contracts";
import { ApiError, type StaffApi } from "./api";
import { checkRegisterChallenge, CeremonyMismatch } from "./challenge";
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

/**
 * `credentialId` is the new credential's id as the browser reported it (base64url): the success page's sign-in asks for
 * that key alone.
 */
export type EnrollResult = { ok: true; key: StaffKey; credentialId: string } | { ok: false; code: string; status: number; cleanup: Cleanup };

/** The two refusals that mean the browser made and kept a credential the console will never accept. */
const KEPT_BUT_REFUSED = new Set(["staff_key_not_device_bound", "staff_key_not_user_verified"]);

const failure = (err: unknown, cleanup: Cleanup = "none"): EnrollResult => {
  const known = err instanceof ApiError || err instanceof CeremonyMismatch ? err : ceremonyFailure(err);
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
    // Before the key is asked: a challenge that is not a staff registration's is never handed to it.
    checkRegisterChallenge(options);
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
    return { ok: true, key, credentialId: response.id };
  } catch (err) {
    if (err instanceof ApiError && KEPT_BUT_REFUSED.has(err.code)) {
      const rp = options.rp as { id?: unknown } | undefined;
      return failure(err, await dropRefused(deps.signal, rpShared, typeof rp?.id === "string" ? rp.id : undefined, response.id));
    }
    return failure(err);
  }
}
```

### Replace `apps/admin/src/messages.ts` (whole file)

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
 * a browser prompt that did not finish, step-up options that bind something other than the action the person chose, and
 * sign-in or enrolment options whose challenge is not one of that ceremony's.
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
  signin_mismatch:
    "The sign-in could not be checked: the server asked your key to sign something other than a sign-in, so your key was not asked. Reload the page and try again; if it happens again, tell the operator.",
  enroll_mismatch:
    "The registration could not be checked: the server asked your key for something other than a staff key's registration, so your key was not asked. Reload the page and try again; if it happens again, tell the operator.",
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

### Replace `apps/admin/src/screens/Audit.tsx` (whole file)

```tsx
import type { AuditEntry } from "@korbat/contracts";
import { useEffect, useMemo, useState } from "react";
import type { StaffApi } from "../api";
import { AUDIT_PAGE_LOADING, createAuditPager, createAuditReader, parsePlace, type AuditPageView } from "../audit-log";
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

/**
 * What the page says about the place it was opened at, once its rows have arrived. The reader answers a place with the
 * page whose newest row is at or before it, and a place beyond the newest row with the newest page, so a first row at
 * another place means there is no row at the place asked for: the clearest sign that rows were removed or the server
 * restored, which the page says rather than naming the page after a place it does not hold.
 */
function placeNotice(at: number | null, page: Loadable<AuditEntry[]>) {
  if (at === null || page.state !== "ready") return null;
  const first = page.value[0]?.seq;
  if (first === at) return <p className="quiet">{`From place ${at}, newest first.`}</p>;
  const nearest = first === undefined ? "The audit log holds no rows." : `The nearest row before it is at place ${first}.`;
  return (
    <p role="alert" className="error">
      {`There is no row at place ${at}. ${nearest} If you kept place ${at}, tell the operator: rows may have been removed, or the server restored from a backup.`}
    </p>
  );
}

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
      {placeNotice(at, page)}
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
  const [view, setView] = useState<AuditPageView>(AUDIT_PAGE_LOADING);
  // Each answer is shown only on the page it was asked for (createAuditPager).
  const pager = useMemo(() => createAuditPager(reader, setView), [reader]);
  const [place, setPlace] = useState("");
  const [placeError, setPlaceError] = useState<string | null>(null);

  useEffect(() => {
    void pager.newest();
    return () => pager.stop();
  }, [pager]);

  const goToPlace = () => {
    const target = parsePlace(place);
    if (target === null) {
      setPlaceError(PLACE_RULE);
      return;
    }
    setPlaceError(null);
    void pager.at(target);
  };

  return (
    <AuditView
      page={view.page}
      hasOlder={view.cursor !== null}
      loadingOlder={view.loadingOlder}
      at={view.at}
      place={place}
      placeError={placeError}
      error={view.error}
      onLoadOlder={() => void pager.older()}
      onPlace={setPlace}
      onGoToPlace={goToPlace}
      onNewest={() => void pager.newest()}
    />
  );
}
```

### Replace `apps/admin/src/screens/Enroll.tsx` (whole file)

```tsx
import { OpaqueId, StaffKeyName, type StaffKeyKind } from "@korbat/contracts";
import { useState } from "react";
import type { StaffApi } from "../api";
import { enrollKey, type EnrollResult, type SignalApi } from "../enroll";
import { describeError, messageFor } from "../messages";
import { signInWithKey } from "../sign-in";
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

/**
 * The sign-in the success page runs with the key just registered (3a design, section 2: "after each enrolment the person
 * signs in once with the new key, which fails when the key stored is not theirs"): not yet asked, under way, the key
 * opened the console, or it did not, with the console's words for why.
 */
export type KeyCheck = { state: "none" } | { state: "busy" } | { state: "opened" } | { state: "failed"; message: string };

export interface EnrollViewProps {
  /** Whether the link's token has the shape of one: a malformed link asks nothing of the API. */
  tokenValid: boolean;
  name: string;
  nameError: string | null;
  /** The button whose ceremony is under way. */
  busy: StaffKeyKind | null;
  result: EnrollResult | null;
  check: KeyCheck;
  onName(name: string): void;
  onRegister(kind: StaffKeyKind): void;
  onCheck(): void;
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

export function EnrollView({ tokenValid, name, nameError, busy, result, check, onName, onRegister, onCheck }: EnrollViewProps) {
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
    // The check runs here, with this key alone, rather than on the sign-in page: that page shows home to a browser that
    // already holds a staff session (the usual case for a second key) and asks no key at all.
    if (check.state === "opened") {
      return (
        <section className="panel" aria-labelledby="enroll-title">
          {heading}
          <p role="status">
            The staff key <UserText>{result.key.name}</UserText> opened the console: you are signed in with it.
          </p>
          <p>
            <a href="/">Go to the home page</a>
          </p>
        </section>
      );
    }
    return (
      <section className="panel" aria-labelledby="enroll-title">
        {heading}
        <p role="status">
          The staff key <UserText>{result.key.name}</UserText> is registered.
        </p>
        <p>Sign in with it once now, so you know that it opens the console. If it does not, tell the operator at once.</p>
        <button type="button" className="primary" onClick={onCheck} disabled={check.state === "busy"} aria-busy={check.state === "busy"}>
          Sign in with this key
        </button>
        {check.state === "failed" ? (
          <div role="alert" className="error">
            <p>{check.message}</p>
            <p>If this key does not open the console, tell the operator at once: the key stored for you may not be this one.</p>
          </div>
        ) : null}
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
  const [check, setCheck] = useState<KeyCheck>({ state: "none" });

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

  /**
   * Signs in with the key just registered and with no other: the prompt's allow list is narrowed to its credential, and the
   * sign-in runs whatever staff session the browser already holds, which the new session's cookies replace.
   */
  const checkKey = async () => {
    if (!result?.ok) return;
    setCheck({ state: "busy" });
    try {
      await signInWithKey({ api, credentials }, result.credentialId);
      setCheck({ state: "opened" });
    } catch (err) {
      setCheck({ state: "failed", message: describeError(err) });
    }
  };

  return (
    <EnrollView
      tokenValid={tokenValid}
      name={name}
      nameError={nameError}
      busy={busy}
      result={result}
      check={check}
      onName={setName}
      onRegister={(kind) => void register(kind)}
      onCheck={() => void checkKey()}
    />
  );
}
```

### Replace `apps/admin/src/screens/Home.tsx` (whole file)

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
      const outcome = await revokeSessionWithKey({ api, credentials }, handle);
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

### Replace `apps/admin/src/screens/SignIn.tsx` (whole file)

```tsx
import type { StaffMe } from "@korbat/contracts";
import { useState } from "react";
import { ApiError, type StaffApi } from "../api";
import { describeError } from "../messages";
import { signInWithKey } from "../sign-in";
import type { CredentialsLike } from "../webauthn";

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
      // The options' challenge is checked before the key is asked; any key the browser holds for the console may answer.
      const me = await signInWithKey({ api, credentials });
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

### Replace `apps/admin/src/step-up.ts` (whole file)

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
 * "Sign out that session", confirmed by the key: the session's handle read from a marked /me right before, since the API
 * binds the challenge to the session the request's cookie names, which another tab's sign-in may have replaced since the
 * page read its session; then options for exactly this action, asked right before the key (the API reads a step-up
 * challenge only while more than a minute of its ten is left), checked, signed, then sent with the revocation. "gone"
 * when the session had already ended. Every request is marked: the person clicked.
 */
export async function revokeSessionWithKey(deps: { api: StaffApi; credentials: CredentialsLike }, targetHandle: string): Promise<"revoked" | "gone"> {
  const action = sessionRevokeAction(targetHandle);
  const { sessionHandle } = await deps.api.me({ activity: true });
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

### Replace `apps/admin/src/store.ts` (whole file)

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
  // Any screen's /me read, the step-up's included, keeps the page's session as the cookie names it now.
  api.hooks.onMe = (me) => {
    if (state.session.kind === "signed-in") set({ session: { kind: "signed-in", me } });
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

### Replace `apps/api/src/auth/admin.ts` (whole file)

```ts
import type { Mailer } from "../mail/mailer";
import { noticeTime } from "./flows/notify";
import type { AuthRepo, UserRole } from "./repo";
import type { Sessions } from "./sessions";

/** The audit log's actor for changes made from the server's command line rather than by a signed-in person. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/** What a role change did, for the command line's report. */
export interface RoleGranted {
  userId: string;
  previousRole: UserRole;
  staffSessionsRevoked: number;
  /** Unused enrolment links deleted, so none issued before the change enrols anything. */
  enrollmentsDeleted: number;
  /** Staff keys revoked: every live one on a change to user, none otherwise. */
  staffKeysRevoked: number;
  /** Why the staff_keys_revoked mail could not be sent, or null when it was sent or none was due. The change stands either way. */
  mailError: string | null;
  /**
   * Why the revoked app sessions' cache tombstones could not be written (Valkey unreachable), or null. The change stands:
   * the sessions are revoked in the database, and a cached copy lasts at most the cache's TTL.
   */
  tombstoneError: string | null;
}

/**
 * Changes an account's role. Used only by the server-side CLI; there is no API endpoint for it.
 * Every session and staff session of the account is revoked and every unused enrolment link deleted, so the new role (and
 * its MFA requirement) applies at once; a change to user also revokes every staff key (3a design, section 7). The change,
 * the revocations and their audit rows are one transaction on the auth role; after it commits, the cached sessions get
 * their tombstones and, when a staff key was revoked, the owner is mailed the keys' names. Both are best effort and
 * independent of each other: the change has committed, so a step that fails is reported to the caller, undoes nothing,
 * and never keeps the other from running (a Valkey outage must not cost the owner the mail that their keys went).
 */
export async function grantRole(deps: { repo: AuthRepo; sessions: Sessions; mailer: Mailer }, email: string, role: UserRole): Promise<RoleGranted> {
  const now = new Date();
  const changed = await deps.repo.changeRole(email, role, { actorId: SYSTEM_ACTOR_ID, now });
  if (!changed) throw new Error(`no account for ${email}`);
  let tombstoneError: string | null = null;
  try {
    await deps.sessions.tombstone(changed.sessionIds);
  } catch (err) {
    tombstoneError = err instanceof Error ? err.message : String(err);
  }
  let mailError: string | null = null;
  if (changed.keysRevoked.length > 0) {
    try {
      await deps.mailer.send({
        to: changed.email,
        template: "staff_keys_revoked",
        data: { names: changed.keysRevoked.map((key) => `"${key.name}"`).join(", "), time: noticeTime(now) },
      });
    } catch (err) {
      mailError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    userId: changed.userId,
    previousRole: changed.previousRole,
    staffSessionsRevoked: changed.staffSessionsRevoked,
    enrollmentsDeleted: changed.enrollmentsDeleted,
    staffKeysRevoked: changed.keysRevoked.length,
    mailError,
    tombstoneError,
  };
}
```

### Replace `apps/api/src/auth/index.ts` (whole file)

```ts
/**
 * The only file outside `src/auth/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type {
  DeleteConfirmRequest,
  DeleteStartResponse,
  StaffEnrollOptionsRequest,
  StaffEnrollVerifyRequest,
  StaffEnrollVerifyResponse,
  StaffKeysResponse,
  StaffMe,
  StaffSessionsResponse,
  StaffSignInVerifyRequest,
  StaffStepUpAction,
  StaffStepUpOptionsRequest,
} from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { Context, MiddlewareHandler } from "hono";
import type Redis from "ioredis";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { AppEnv } from "../env";
import type { Mailer } from "../mail/mailer";
import { clientIdentity } from "./client-ip";
import { authConfigFrom, type AuthDeps, type ProfileStore, type RequestContext, type StaffRequestContext } from "./context";
import { confirmDeletion, finishPurge, startDeletion } from "./flows/deletion";
import { exportAccount, type AccountExport } from "./flows/export";
import { redisKv, type KeyValueStore } from "./kv";
import { createLockout } from "./lockout";
import { requireFreshAuth, requireOnboarding, requireSession, requireStrongFreshAuth, resolveSession } from "./middleware";
import type { JobLock } from "../lib/jobs";
import { createJanitor } from "./janitor";
import { hibpChecker, type BreachChecker } from "./passwords";
import { createAuthRepo, type AuthEventType } from "./repo";
import { authRoutes, meHandler } from "./routes";
import { createSessions, type Session } from "./sessions";
import type { PublicKeyCredentialRequestOptionsJSON } from "./passkeys/webauthn";
import { enrollOptions, enrollVerify, type StaffEnrollOptions } from "./staff/enroll";
import { requireStaff } from "./staff/middleware";
import { listStaffKeys, listStaffSessions, signOutStaff, staffMe, type ActiveStaffSession } from "./staff/sessions";
import { signInOptions, signInVerify, type StaffSignedIn } from "./staff/signin";
import { requireStaffStepUp, revokeStaffSession, stepUpOptions, type StaffStepUpConfirmed } from "./staff/step-up";
import { cloudflareTurnstile, type TurnstileVerifier } from "./turnstile";
import { devProvider } from "./verify/dev";
import type { VerificationProvider } from "./verify/provider";
import { vonageProvider } from "./verify/vonage";

export type { ProfileStore, RequestContext, StaffRequestContext } from "./context";
export type { AccountExport } from "./flows/export";
export type { AuthEventType, UserRole } from "./repo";
export type { ProxyTrust } from "./client-ip";
export type { Session } from "./sessions";
export type { ActiveStaffSession } from "./staff/sessions";
export type { StaffSignedIn } from "./staff/signin";
export type { StaffStepUpConfirmed } from "./staff/step-up";
export type { StaffKeysRevokedReport } from "./staff/revoke";
export type { VerificationProvider } from "./verify/provider";
export { AuthError, isUniqueViolation } from "./context";
export { SYSTEM_ACTOR_ID, grantRole, type RoleGranted } from "./admin";
/** The account module clears a web session's cookies after a deletion; the cookie names and attributes stay this module's. */
export { clearSessionCookies } from "./cookies";
/**
 * The staff module's sign-in and sign-out routes set and clear the staff cookies (3a design, section 5); their names and
 * attributes stay this module's, and requireStaff is their only reader.
 */
export { clearStaffCookies, setStaffCookies } from "./staff/cookies";
/** `staff.js revoke`, from the server's command line only, as grant-role's grantRole is. */
export { revokeStaffKeys } from "./staff/revoke";
/**
 * audit-verify's check of a step-up assertion an audit row stored, against the public key, origin and relying party ID
 * recorded on its key (3a design, section 7, Command line): the WebAuthn library stays behind the wrapper, and the check
 * needs no server secret.
 */
export { verifyRecordedAssertion, type RecordedAssertion } from "./passkeys/webauthn";
export { checkHandle } from "./handles";
export { redisKv, type KeyValueStore } from "./kv";
export { createAuthRepo } from "./repo";
export { createSessions } from "./sessions";

/**
 * What the account module needs from this one (1b design, section 5): the auth side of a deletion
 * (the code, the confirmation that takes the account down, the purge's list and its last step), the
 * auth side of the data export, and the event log for what the account module does.
 */
export interface AuthForAccount {
  /** Mails the deletion code to the account's own address and answers the flow id. */
  startDeletion(session: Session, ctx: RequestContext): Promise<DeleteStartResponse>;
  /** Checks the typed handle and the code, then marks the account deleted and revokes every session, in one transaction: from here the account is gone. */
  confirmDeletion(session: Session, input: DeleteConfirmRequest): Promise<void>;
  /** Deleted accounts whose auth row is not anonymised yet, oldest deletion first. */
  pendingPurges(): Promise<string[]>;
  /** Finishes step 1's rows if a take-down stopped after the mark, then anonymises the auth row and marks it purged; a no-op when it already is. */
  finishPurge(userId: string): Promise<void>;
  /** The account's facts, its passkeys (without their keys), its live sessions, its devices and its own events. */
  exportAccount(userId: string): Promise<AccountExport>;
  appendEvent(userId: string, type: AuthEventType, metadata?: Record<string, unknown>): Promise<void>;
}

/**
 * What the staff module needs from this one (3a design, section 5): the credential side of the staff routes, which the
 * staff module mounts behind its gate. Staff keys, staff sessions and enrolments are credentials, so their flows and
 * tables stay here, and the staff module reaches them only through this interface.
 */
export interface AuthForStaff {
  /** Registration options for the key an enrolment link's holder is about to create. */
  enrollOptions(input: StaffEnrollOptionsRequest): Promise<StaffEnrollOptions>;
  /** Checks the browser's answer and stores the staff key, spending the link; the owner is mailed. */
  enrollVerify(input: StaffEnrollVerifyRequest, ctx: StaffRequestContext): Promise<StaffEnrollVerifyResponse>;
  /** Discoverable-credential options for a staff sign-in. */
  signInOptions(): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }>;
  /** Checks a staff key's assertion and opens a staff session; the route sets its cookies with setStaffCookies. */
  signInVerify(input: StaffSignInVerifyRequest, ctx: StaffRequestContext): Promise<StaffSignedIn>;
  /** Stands before every staff route that needs a session: reads it and sets `staffSession` on the context. */
  requireStaff: MiddlewareHandler<AppEnv>;
  /** The session's account and both its ends, with the seconds left. */
  me(session: ActiveStaffSession): Promise<StaffMe>;
  /** The person's own live staff sessions. */
  sessions(session: ActiveStaffSession): Promise<StaffSessionsResponse>;
  /** The person's own live staff keys. */
  keys(session: ActiveStaffSession): Promise<StaffKeysResponse>;
  /** Ends the session, on the record; the route clears its cookies with clearStaffCookies. */
  signOut(session: ActiveStaffSession, ctx: StaffRequestContext): Promise<void>;
  /** Options for confirming one action with the session's key: a challenge bound to the session and to exactly that action. */
  stepUpOptions(session: ActiveStaffSession, request: StaffStepUpOptionsRequest): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }>;
  /**
   * Stands before every staff route that changes something, behind requireStaff: verifies the body's `stepUp` against the
   * action, the target `target` reads from the request and the body's params, and sets `staffStepUp` on the context.
   */
  requireStaffStepUp(action: StaffStepUpAction, target: (c: Context<AppEnv>) => string | undefined): MiddlewareHandler<AppEnv>;
  /** Revokes one of the person's own live staff sessions, on the record with its confirmation; false when the handle names none. */
  revokeSession(session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: StaffRequestContext): Promise<boolean>;
}

export interface CreateAuthOptions {
  config: Config;
  logger: Logger;
  /** The korbat_auth pool. The auth module never receives the API pool. */
  authDb: Db;
  mailer: Mailer;
  profiles: ProfileStore;
  /** Either a Redis client or a ready key-value store (tests use an in-memory store). */
  redis?: Redis;
  kv?: KeyValueStore;
  turnstile?: TurnstileVerifier;
  breachChecker?: BreachChecker;
  /**
   * The phone verification provider behind the verified badge. Absent or null, the badge routes answer
   * badge_unavailable; the server passes verificationProviderFrom(config), tests the development provider.
   */
  verify?: VerificationProvider | null;
  now?: () => Date;
}

/**
 * The provider VERIFY_PROVIDER names: none for `off` (the badge is hidden), the fixed-code one for `dev`,
 * Vonage Verify with the configured credentials and brand for `vonage`. `fetchFn` is for tests only.
 */
export function verificationProviderFrom(config: Config, fetchFn?: typeof fetch): VerificationProvider | null {
  switch (config.VERIFY_PROVIDER) {
    case "off":
      return null;
    case "dev":
      return devProvider();
    case "vonage":
      // Production refuses this configuration in config.ts; development gets the same refusal here, at start-up, rather than a failing first request.
      if (!config.VONAGE_API_KEY || !config.VONAGE_API_SECRET) throw new Error("VERIFY_PROVIDER=vonage needs VONAGE_API_KEY and VONAGE_API_SECRET");
      return vonageProvider({ apiKey: config.VONAGE_API_KEY, apiSecret: config.VONAGE_API_SECRET, brand: config.VERIFY_BRAND, fetch: fetchFn });
  }
}

export function createAuth(options: CreateAuthOptions) {
  const kv = options.kv ?? (options.redis ? redisKv(options.redis) : undefined);
  if (!kv) throw new Error("createAuth needs a Redis client or a key-value store");
  const now = options.now ?? (() => new Date());
  const repo = createAuthRepo(options.authDb);
  const sessions = createSessions({ repo, kv, now });
  const deps: AuthDeps = {
    repo,
    kv,
    sessions,
    lockout: createLockout({ repo, kv, now }),
    mailer: options.mailer,
    turnstile: options.turnstile ?? cloudflareTurnstile(options.config.TURNSTILE_SECRET_KEY),
    breachChecker: options.breachChecker ?? hibpChecker(),
    profiles: options.profiles,
    verify: options.verify ?? null,
    config: authConfigFrom(options.config),
    log: options.logger,
    now,
  };
  /** A security event about an account, for the modules that own no auth table (the social module's profile and handle changes, the account module's export). */
  const appendEvent = (userId: string, type: AuthEventType, metadata?: Record<string, unknown>) => repo.appendEvent({ userId, type, metadata });
  const forAccount: AuthForAccount = {
    startDeletion: (session, ctx) => startDeletion(deps, session, ctx),
    confirmDeletion: (session, input) => confirmDeletion(deps, session, input),
    pendingPurges: () => repo.pendingPurges(),
    finishPurge: (userId) => finishPurge(deps, userId),
    exportAccount: (userId) => exportAccount(deps, userId),
    appendEvent,
  };
  const staffGuard = requireStaff(deps);
  const forStaff: AuthForStaff = {
    enrollOptions: (input) => enrollOptions(deps, input),
    enrollVerify: (input, ctx) => enrollVerify(deps, input, ctx),
    signInOptions: () => signInOptions(deps),
    signInVerify: (input, ctx) => signInVerify(deps, input, ctx),
    requireStaff: staffGuard,
    me: (session) => staffMe(deps, session),
    sessions: (session) => listStaffSessions(deps, session),
    keys: (session) => listStaffKeys(deps, session),
    signOut: (session, ctx) => signOutStaff(deps, session, ctx),
    stepUpOptions: (session, request) => stepUpOptions(deps, session, request),
    requireStaffStepUp: (action, target) => requireStaffStepUp(deps, action, target),
    revokeSession: (session, confirmed, ctx) => revokeStaffSession(deps, session, confirmed, ctx),
  };
  return {
    deps,
    routes: authRoutes(deps),
    me: meHandler(deps),
    appendEvent,
    /** The interface the account module uses. */
    forAccount,
    /** The interface the staff module uses. */
    forStaff,
    /** Runs first on every request: resolves the client address the way TRUST_PROXY says and hashes it. */
    clientIdentity: clientIdentity({ trust: deps.config.trustProxy, ipHashKey: deps.config.ipHashKey }),
    resolveSession: resolveSession(deps),
    requireSession,
    requireOnboarding,
    requireFreshAuth: (maxAgeSeconds?: number) => requireFreshAuth(deps, maxAgeSeconds),
    /** Level 2 within the window on an account with TOTP, level 1 otherwise: for the routes of the 1c design's section 10. */
    requireStrongFreshAuth: (maxAgeSeconds?: number) => requireStrongFreshAuth(deps, maxAgeSeconds),
    /** A staff session from the staff cookie, read from the database at every request (3a design, section 7). */
    requireStaff: staffGuard,
    /** A fresh confirmation by the staff session's key, bound to the action a route is about to execute (3a design, section 7). */
    requireStaffStepUp: forStaff.requireStaffStepUp,
    /** Starts the retention pass (dead codes, old sessions and staff sessions, spent enrolment links, device address hashes, old events) and returns the function that stops it. */
    startJanitor: (lock: JobLock) => createJanitor(deps, lock).start(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
```

### Replace `apps/api/src/auth/passkeys/challenge.ts` (whole file)

```ts
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { CEREMONY_CHALLENGE, CHALLENGE_PURPOSES, STAFF_STEP_UP_CHALLENGE, stepUpBindingText } from "@korbat/contracts";
import { AuthError } from "../context";
import { sha256Hex } from "../crypto";
import type { KeyValueStore } from "../kv";
import { MINUTE } from "../limits";

/**
 * Which ceremony a challenge was issued for; a challenge answers only the ceremony it names. The staff console's two
 * (3a design, section 5) share the layout, the key, the lifetime and the used-challenge markers, so an app sign-in
 * challenge never opens the console's sign-in and a personal passkey's registration challenge never enrols a staff key.
 * The staff step-up has a layout of its own (issueStepUpChallenge below), with the same key, lifetime and markers.
 */
export type ChallengePurpose = "signin" | "register" | "reauth" | "staff_signin" | "staff_register";

/** How long a challenge is valid: the top of WebAuthn L3's recommended range for a ceremony. */
export const CHALLENGE_TTL_MS = 10 * MINUTE;

/**
 * A step-up challenge is read only while at least this much of its life is left. Its action's audit row is stamped by the
 * database after the WebAuthn check, the counter update and the waits for the account's row and the audit head, and
 * audit-verify refuses a row written at or after the challenge's expiry; such a row can never be repaired. A minute is
 * harmless under the browser's 5-minute prompt, and the expiry the challenge carries stays the full ten minutes.
 */
export const STEP_UP_READ_MARGIN_MS = MINUTE;

// The purpose codes and the layout are the contracts', which the console reads too: it checks a staff sign-in's and a
// staff registration's challenge against them before it asks for the key.
const VERSION = CEREMONY_CHALLENGE.version;
const PURPOSE_CODES: Record<ChallengePurpose, number> = CHALLENGE_PURPOSES;

// The layout: version (1 byte), purpose (1), expiry in epoch milliseconds (8, big-endian), nonce (16), binding (16), then
// the first 16 bytes of HMAC-SHA256 over the 42 before them.
const PURPOSE_AT = CEREMONY_CHALLENGE.purposeAt;
const EXPIRY_AT = CEREMONY_CHALLENGE.expiryAt;
const NONCE_AT = CEREMONY_CHALLENGE.nonceAt;
const BINDING_AT = CEREMONY_CHALLENGE.bindingAt;
const MAC_AT = CEREMONY_CHALLENGE.sealAt;
const NONCE_BYTES = CEREMONY_CHALLENGE.nonceBytes;
const BINDING_BYTES = CEREMONY_CHALLENGE.bindingBytes;
const MAC_BYTES = CEREMONY_CHALLENGE.sealBytes;
const CHALLENGE_BYTES = CEREMONY_CHALLENGE.bytes;
/** 58 bytes as unpadded base64url. */
const ENCODED_LENGTH = CEREMONY_CHALLENGE.encodedLength;
// The step-up layout, at the contracts' offsets, which audit-verify and the console read too: version (1 byte), purpose
// (1), expiry (8), nonce (16), the full 32-byte binding, then the first 16 bytes of HMAC-SHA256 over the 58 before them.
const STEP_UP = STAFF_STEP_UP_CHALLENGE;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The used-challenge markers in the key-value store, keyed by the challenge's hash rather than the challenge itself. */
const USED_PREFIX = "webauthn-used:";

const derivedKeys = new WeakMap<Buffer, Buffer>();

/**
 * The key challenges are sealed with: HKDF-SHA256 of AUTH_HMAC_KEY under its own label, so no other use of that key can
 * produce a valid seal. It is derived once per key buffer; the flows can ask for it on every request.
 */
export function challengeKey(authHmacKey: Buffer): Buffer {
  let key = derivedKeys.get(authHmacKey);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", authHmacKey, "", "korbat-webauthn-challenge", 32));
    derivedKeys.set(authHmacKey, key);
  }
  return key;
}

const invalid = () => new AuthError("passkey_invalid", 401);
const expired = () => new AuthError("challenge_expired", 400);

/**
 * The first 16 bytes of sha256 of what the challenge is bound to (a session's handle, or a staff enrolment's id), zeros
 * for one bound to nothing (the two sign-ins).
 */
function binding(boundTo: string | undefined): Buffer {
  if (boundTo === undefined) return Buffer.alloc(BINDING_BYTES);
  return createHash("sha256").update(boundTo).digest().subarray(0, BINDING_BYTES);
}

function seal(key: Buffer, signed: Buffer): Buffer {
  return createHmac("sha256", key).update(signed).digest().subarray(0, MAC_BYTES);
}

/**
 * The challenge's bytes in one layout (58 bytes for the ceremonies' challenges, 74 for a step-up's), or null for anything
 * else. Only the canonical encoding is accepted: Node's decoder ignores the spare bits of the last character, so without
 * this check several strings would name the same challenge, and each would get its own used-challenge marker.
 */
function decodeAs(challenge: string, length: number, encodedLength: number): Buffer | null {
  if (typeof challenge !== "string" || challenge.length !== encodedLength || !BASE64URL.test(challenge)) return null;
  const bytes = Buffer.from(challenge, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== challenge) return null;
  return bytes;
}

const decode = (challenge: string) => decodeAs(challenge, CHALLENGE_BYTES, ENCODED_LENGTH);

/** A challenge of either layout, for spending: both keep their expiry at the same offset. */
const decodeAny = (challenge: string) => decode(challenge) ?? decodeAs(challenge, STEP_UP.bytes, STEP_UP.encodedLength);

/**
 * A stateless WebAuthn challenge: its purpose, its expiry (10 minutes from now), a random nonce and a binding, sealed with
 * an HMAC. Registration and re-authentication bind it to the session's handle, a staff registration to its enrolment's id,
 * and the two sign-ins to nothing. Handing one out stores nothing, so the unauthenticated sign-in options cannot fill the
 * key-value store.
 */
export function issueChallenge(key: Buffer, purpose: ChallengePurpose, now: Date, boundTo?: string): string {
  const bytes = Buffer.alloc(CHALLENGE_BYTES);
  bytes[0] = VERSION;
  bytes[PURPOSE_AT] = PURPOSE_CODES[purpose];
  bytes.writeBigUInt64BE(BigInt(now.getTime() + CHALLENGE_TTL_MS), EXPIRY_AT);
  randomBytes(NONCE_BYTES).copy(bytes, NONCE_AT);
  binding(boundTo).copy(bytes, BINDING_AT);
  seal(key, bytes.subarray(0, MAC_AT)).copy(bytes, MAC_AT);
  return bytes.toString("base64url");
}

/**
 * Checks a challenge a ceremony's client data names before any WebAuthn verification runs: the seal first, in constant
 * time, so a forged challenge says nothing about which field failed; then the version, the purpose and the binding
 * (`passkey_invalid`), and only then the expiry (`challenge_expired`), which the app answers by starting over. Pass what
 * the challenge was issued bound to: the session's handle for registration and re-authentication, the enrolment's id for
 * a staff registration, nothing for the sign-ins. The staff flows answer this function's passkey_invalid with a staff code.
 */
export function readChallenge(key: Buffer, challenge: string, purpose: ChallengePurpose, now: Date, boundTo?: string): void {
  const bytes = decode(challenge);
  if (!bytes) throw invalid();
  if (!timingSafeEqual(bytes.subarray(MAC_AT), seal(key, bytes.subarray(0, MAC_AT)))) throw invalid();
  if (bytes[0] !== VERSION || bytes[PURPOSE_AT] !== PURPOSE_CODES[purpose]) throw invalid();
  if (!bytes.subarray(BINDING_AT, MAC_AT).equals(binding(boundTo))) throw invalid();
  if (now.getTime() >= Number(bytes.readBigUInt64BE(EXPIRY_AT))) throw expired();
}

/**
 * The binding of a step-up challenge (3a design, section 7, Step-up): all 32 bytes of the sha256 of the staff session's
 * handle, a newline and the action's hash, so audit-verify and the console can recompute it from what they hold, without
 * the sealing key.
 */
function stepUpBinding(sessionHandle: string, actionHash: string): Buffer {
  return createHash("sha256").update(stepUpBindingText(sessionHandle, actionHash)).digest();
}

/**
 * A staff step-up challenge: the step-up purpose, its expiry (10 minutes from now, as every other ceremony's), a random
 * nonce and the binding of the session and the action, sealed with the same key as the other challenges. An assertion
 * made over it confirms that one action in that one session and nothing else. Handing one out stores nothing.
 */
export function issueStepUpChallenge(key: Buffer, now: Date, sessionHandle: string, actionHash: string): string {
  const bytes = Buffer.alloc(STEP_UP.bytes);
  bytes[STEP_UP.versionAt] = STEP_UP.version;
  bytes[STEP_UP.purposeAt] = STEP_UP.purpose;
  bytes.writeBigUInt64BE(BigInt(now.getTime() + CHALLENGE_TTL_MS), STEP_UP.expiryAt);
  randomBytes(STEP_UP.nonceBytes).copy(bytes, STEP_UP.nonceAt);
  stepUpBinding(sessionHandle, actionHash).copy(bytes, STEP_UP.bindingAt);
  seal(key, bytes.subarray(0, STEP_UP.sealAt)).copy(bytes, STEP_UP.sealAt);
  return bytes.toString("base64url");
}

/**
 * Checks a step-up challenge as readChallenge checks the others: the seal first, in constant time; then the version, the
 * purpose and the binding of this session and this action (`passkey_invalid`); and only then the expiry
 * (`challenge_expired`), which here comes a minute early (STEP_UP_READ_MARGIN_MS), so the action's row is written before
 * it. A challenge of the other layout is refused by its length. The step-up flow answers this function's passkey_invalid
 * with staff_step_up_invalid. Returns the challenge's expiry, by which the confirmed action's row must be in the chain.
 */
export function readStepUpChallenge(key: Buffer, challenge: string, now: Date, sessionHandle: string, actionHash: string): Date {
  const bytes = decodeAs(challenge, STEP_UP.bytes, STEP_UP.encodedLength);
  if (!bytes) throw invalid();
  if (!timingSafeEqual(bytes.subarray(STEP_UP.sealAt), seal(key, bytes.subarray(0, STEP_UP.sealAt)))) throw invalid();
  if (bytes[STEP_UP.versionAt] !== STEP_UP.version || bytes[STEP_UP.purposeAt] !== STEP_UP.purpose) throw invalid();
  if (!bytes.subarray(STEP_UP.bindingAt, STEP_UP.sealAt).equals(stepUpBinding(sessionHandle, actionHash))) throw invalid();
  const expiry = Number(bytes.readBigUInt64BE(STEP_UP.expiryAt));
  if (now.getTime() + STEP_UP_READ_MARGIN_MS >= expiry) throw expired();
  return new Date(expiry);
}

/**
 * Makes a challenge single-use, a step-up's included; call it right after readChallenge or readStepUpChallenge, before the
 * WebAuthn verification, so a challenge stays spent whatever happens next. The marker lives for the rest of the
 * challenge's lifetime: after that the read refuses the challenge anyway. A second spend is `passkey_invalid`.
 */
export async function spendChallenge(kv: KeyValueStore, challenge: string, now: Date): Promise<void> {
  const bytes = decodeAny(challenge);
  if (!bytes) throw invalid();
  const remaining = Number(bytes.readBigUInt64BE(EXPIRY_AT)) - now.getTime();
  // Refused as readChallenge refuses it, which also keeps the store from being handed a TTL of zero or less (Redis refuses one).
  if (remaining <= 0) throw expired();
  if (!(await kv.setIfAbsent(USED_PREFIX + sha256Hex(challenge), "1", remaining))) throw invalid();
}
```

### Replace `apps/api/src/auth/repo.ts` (whole file)

```ts
import { and, asc, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import {
  authEventType,
  authEvents,
  devices,
  emailCodePurpose,
  emailCodes,
  passkeys,
  sessions,
  staffEnrollments,
  staffKeys,
  staffSessions,
  userRole,
  users,
  type Db,
} from "@korbat/db";
import { SYSTEM_ACTOR_ID } from "./admin";

/**
 * Every SQL statement the auth module runs. It receives only the korbat_auth pool and touches only
 * tables in the `auth` schema. Single-use and replay rules are enforced with conditional updates so
 * two concurrent requests cannot both succeed.
 */

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type EmailCodeRow = typeof emailCodes.$inferSelect;
export type AuthEventType = (typeof authEventType.enumValues)[number];
export type EmailCodePurpose = (typeof emailCodePurpose.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
export type PasskeyRow = typeof passkeys.$inferSelect;
/** A passkey with the label of the device that added it, null once that device is gone. */
export type PasskeyListRow = PasskeyRow & { createdOn: string | null };
/** What a registration stores of a verified passkey; the id, the last use and the suspicion are the row's own. */
export type NewPasskey = Omit<PasskeyRow, "id" | "lastUsedAt" | "suspectAt">;

/** The per-account bounds a registration checks in its transaction (1c design, section 2): at most `passkeys` at a time, and `additions` within `windowMs`. */
export interface PasskeyLimits {
  passkeys: number;
  additions: number;
  windowMs: number;
}

/** What addPasskey answers: the row it inserted; which bound refused it, with the seconds until the day has a slot again; or that the account is gone. */
export type AddPasskeyOutcome =
  | { ok: true; passkey: PasskeyRow }
  | { ok: false; reason: "gone" }
  | { ok: false; reason: "cap" }
  | { ok: false; reason: "daily"; retryAfterSeconds: number };

/** What the lockdown's transaction is told (1c design, sections 2 and 7.6); the flow works it out from the caller's anchor. */
export interface LockDownInput {
  /** The flows' clock, for the revocations and the password's change time. */
  now: Date;
  /** How far back the lockdown reaches: passkeys created at or after this go, and two-factor enabled at or after it is turned off. */
  since: Date;
  /** Passkeys to remove whatever their age: the one that signed in, or the one a link is about. */
  passkeyIds: readonly string[];
  /** The caller's event, recorded in the same transaction with what the lockdown did added to its metadata. */
  event: { type: AuthEventType; deviceId: string | null; ipHash: string | null; metadata: Record<string, unknown> };
}

/** What a lockdown did: the ids of the sessions it revoked, for the cache tombstones, the passkeys it removed, and whether it turned two-factor off. */
export interface LockDownOutcome {
  sessionIds: string[];
  passkeysRemoved: string[];
  totpCleared: boolean;
}

export interface ActiveSessionRow {
  id: string;
  userId: string;
  deviceId: string;
  role: UserRole;
  onboardedAt: Date | null;
  totpEnabledAt: Date | null;
  reauthAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  /** The session's id for life, which a rotation keeps. */
  handle: string;
  /** The factors proven, kind to epoch milliseconds; empty for a session from before migration 0010. */
  factors: Record<string, number>;
  passkeyId: string | null;
}

/** A staff enrolment found by its token, with what the enrolment flow checks of its account (3a design, section 7). */
export interface StaffEnrollmentRow {
  id: string;
  userId: string;
  origin: string;
  rpId: string;
  expiresAt: Date;
  usedAt: Date | null;
  email: string;
  role: UserRole;
  deletedAt: Date | null;
  onboardedAt: Date | null;
  webauthnUserId: Buffer | null;
}

/** What the enrolment flow stores of a verified staff key; auth.add_staff_key copies the origin and relying party ID from the enrolment. */
export interface NewStaffKey {
  userId: string;
  enrollmentId: string;
  /** The link's token itself: the function hashes it, so a hash read from the table spends nothing. */
  token: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  name: string;
  aaguid: string;
  requestId: string;
}

/** What addStaffKey answers: the new key's id, or which of auth.add_staff_key's re-checks refused it. */
export type AddStaffKeyOutcome = { ok: true; keyId: string } | { ok: false; reason: "enrollment_invalid" | "limit" };

/** A staff key as the console's sign-in finds it by its credential id, with what the flow checks of its account. */
export interface StaffKeyForSignIn {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  transports: string[];
  name: string;
  revokedAt: Date | null;
  /** The console's origin and relying party ID the key was enrolled for, which audit-verify judges its confirmations by. */
  origin: string;
  rpId: string;
  email: string;
  role: UserRole;
  deletedAt: Date | null;
  webauthnUserId: Buffer | null;
}

/** What a staff sign-in's transaction writes (3a design, section 7, Sign-in): the key's use, the session, its event and its audit row. */
export interface NewStaffSession {
  /** sha256 of the token; the token itself is never stored. */
  id: string;
  userId: string;
  keyId: string;
  /** The counter the verified assertion reported, which the key's row takes only if it moved forward. */
  newCounter: number;
  now: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  browser: string;
  ipHash: string | null;
  requestId: string;
}

/** A live staff session as requireStaff reads it, with its account's role, in one statement joined to its key and its account. */
export interface StaffSessionRow {
  id: string;
  handle: string;
  userId: string;
  keyId: string;
  role: UserRole;
  createdAt: Date;
  lastUsedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  browser: string;
}

/**
 * A revocation of staff keys in one auth transaction (3a design, section 7): `staff.js revoke` with one key or `all`, and the
 * counter rule's revocation of the key that went backwards, which also marks it suspect and records its own event. The
 * account is named by its id (the counter rule knows it) or by its address (the command line).
 */
export interface StaffKeyRevocation {
  account: { id: string } | { email: string };
  key: string | "all";
  suspect: boolean;
  /**
   * Where it came from, as the events and audit rows record it: the command line, or the counter rule at a sign-in or a
   * step-up. The command line also waits at most 10 seconds for a lock.
   */
  via: "cli" | "sign_in" | "step_up";
  actorId: string;
  now: Date;
  requestId?: string | null;
}

/** What a revocation did, for the command line's report and the mail; or why it found nothing to act on. */
export type StaffKeysRevoked =
  | {
      ok: true;
      userId: string;
      /** The account's address as stored, which the mail goes to. */
      email: string;
      /** The keys revoked now, oldest first, each with how many of its staff sessions were revoked now. */
      keys: { id: string; name: string; sessionsRevoked: number }[];
      staffSessionsRevoked: number;
      enrollmentsCancelled: number;
      /** For one key named by the command line: when it was revoked before, in which case nothing changed. */
      alreadyRevokedAt: Date | null;
    }
  | { ok: false; reason: "no_account" | "no_key" };

/** The staff key a staff session was opened with, as its step-up reads it: the credential to verify against and its name for a suspect key's mail. */
export interface StaffKeyCredential {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  transports: string[];
  name: string;
  revokedAt: Date | null;
  /** The console's origin and relying party ID the key was enrolled for, which audit-verify judges its confirmations by. */
  origin: string;
  rpId: string;
}

/**
 * A staff session's revocation confirmed by a step-up (3a design, section 7, Sessions and keys): who confirms it (the
 * account, its session and the key that signed) and what the audit row stores of the confirmation.
 */
export interface ConfirmedStaffSessionRevocation {
  userId: string;
  /** The confirming session's handle, which the step-up's challenge was bound to. */
  staffSession: string;
  keyId: string;
  /** The handle of the session to revoke. */
  handle: string;
  actionHash: string;
  params: Record<string, unknown>;
  stepUp: { authenticatorData: string; clientDataJSON: string; signature: string };
  /** The step-up challenge's expiry: the audit row must join the chain before it, by the database's clock. */
  expiresAt: Date;
  now: Date;
  ipHash: string | null;
  requestId: string;
}

/** A role change as it committed: what it revoked and deleted, for the cache tombstones, the command's report and the mail. */
export interface RoleChange {
  userId: string;
  /** The account's address as stored, which the staff_keys_revoked mail goes to. */
  email: string;
  previousRole: UserRole;
  /** The revoked app sessions' ids, for the cache tombstones. */
  sessionIds: string[];
  staffSessionsRevoked: number;
  enrollmentsDeleted: number;
  /** The staff keys revoked by a change to user, oldest first. */
  keysRevoked: { id: string; name: string }[];
}

export interface SessionListRow {
  /** The hash of the session's token, which its cached copy is keyed by; it changes when the token rotates and is never shown to a client. */
  id: string;
  /** The session's id for life: what the list shows, and what the targeted revoke takes. */
  handle: string;
  deviceLabel: string | null;
  platform: string;
  createdAt: Date;
  lastUsedAt: Date;
}

export function createAuthRepo(db: Db) {
  return {
    // ------------------------------------------------------------ users

    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    async findUserById(id: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    /** The email is already verified (the user proved it with a code) and the age check has passed. */
    async createUser(input: { email: string; termsVersion: string; now: Date }): Promise<UserRow> {
      const [row] = await db
        .insert(users)
        .values({
          email: input.email,
          emailVerifiedAt: input.now,
          ageConfirmedAt: input.now,
          termsVersion: input.termsVersion,
          termsAcceptedAt: input.now,
        })
        .returning();
      return row!;
    },

    async markOnboarded(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ onboardedAt: now }).where(eq(users.id, userId));
    },

    /**
     * Moves the account to an address its owner just proved with a code, so it is verified as of now.
     * When another row holds the address, in any case, the unique index on lower(email) raises the
     * driver's unique violation; the flow reports that as email_in_use.
     */
    async changeEmail(userId: string, email: string, now: Date): Promise<void> {
      await db.update(users).set({ email, emailVerifiedAt: now }).where(eq(users.id, userId));
    },

    /**
     * The keyed hash of the phone number behind the verified badge, or null to drop it. When another row
     * holds the same hash, the partial unique index on phone_hash raises the driver's unique violation;
     * the flow reports that as phone_in_use.
     */
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      await db.update(users).set({ phoneHash }).where(eq(users.id, userId));
    },

    /** Setting or clearing a password also clears any password lockout. */
    async setPasswordHash(userId: string, passwordHash: string | null, now: Date): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, passwordChangedAt: now, failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, userId));
    },

    /** Replaces the hash only, after a sign-in verified the password against older parameters. */
    async replacePasswordHash(userId: string, passwordHash: string): Promise<void> {
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    },

    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      await db.update(users).set({ failedLogins, lockedUntil }).where(eq(users.id, userId));
    },

    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash })
        .where(eq(users.id, userId));
    },

    async disableTotp(userId: string): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] })
        .where(eq(users.id, userId));
    },

    /** The same secret re-encrypted with the current key; nothing else about MFA changes. */
    async setTotpSecretEnc(userId: string, totpSecretEnc: string): Promise<void> {
      await db.update(users).set({ totpSecretEnc }).where(eq(users.id, userId));
    },

    async setRecoveryCodes(userId: string, recoveryCodesHash: string[]): Promise<void> {
      await db.update(users).set({ recoveryCodesHash }).where(eq(users.id, userId));
    },

    /** Claims a TOTP time step. False when this step or a later one was already used. */
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ totpLastStep: step })
        .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    /** Removes one recovery-code hash. False when it is not (or no longer) present. */
    async consumeRecoveryCodeHash(userId: string, codeHash: string): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ recoveryCodesHash: sql`array_remove(${users.recoveryCodesHash}, ${codeHash})` })
        .where(and(eq(users.id, userId), sql`${codeHash} = ANY(${users.recoveryCodesHash})`))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    async setRole(userId: string, role: UserRole): Promise<void> {
      await db.update(users).set({ role }).where(eq(users.id, userId));
    },

    /**
     * A role change (3a design, section 7) in one transaction: the account's row is locked first, FOR NO KEY UPDATE (the
     * lock the role's update would take, and the one every writer of staff rows takes first, so none of them can wait on
     * another in a circle); the role is set, every session and every staff session revoked and every unused enrolment link
     * deleted, so the new role applies at once and no link issued before enrols anything. A change to user also revokes
     * every staff key, with a staff_key_revoked event each: a person made staff again enrols new keys. Last, through
     * auth.append_audit, each revocation's audit row and then the role_granted row, which hold the audit chain's head until
     * the commit, so the change and its record commit together or not at all. Only the command line calls this, and it
     * waits at most 10 seconds for a lock: an API that holds the head or the row open cannot stall it for longer, and one
     * that times out has changed nothing. The cache tombstones and the mail are not the database's to write, so the caller
     * does them after the commit with what this answers; undefined when no live account has the address.
     */
    async changeRole(email: string, role: UserRole, audit: { actorId: string; now: Date }): Promise<RoleChange | undefined> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        const [account] = await tx
          .select({ id: users.id, email: users.email, role: users.role })
          .from(users)
          .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
          .limit(1)
          .for("no key update");
        if (!account) return undefined;
        await tx.update(users).set({ role }).where(eq(users.id, account.id));
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: audit.now })
          .where(and(eq(sessions.userId, account.id), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        const staff = await revokeStaffAccess(tx, account.id, audit.now, { keys: role === "user", enrollments: "unused", via: "role_change" });
        await appendKeyRevocations(tx, audit.actorId, staff, "role_change");
        await appendAudit(tx, {
          actorId: audit.actorId,
          action: "role_granted",
          targetType: "user",
          targetId: account.id,
          // A role change deletes open links only, so every link it deleted was one it cancelled.
          metadata: { from: account.role, to: role, via: "cli", staffSessionsRevoked: staff.staffSessionsRevoked, enrollmentsDeleted: staff.enrollmentsCancelled },
        });
        return {
          userId: account.id,
          email: account.email,
          previousRole: account.role,
          sessionIds: revoked.map((row) => row.id),
          staffSessionsRevoked: staff.staffSessionsRevoked,
          enrollmentsDeleted: staff.enrollmentsCancelled,
          keysRevoked: staff.keys.map(({ id, name }) => ({ id, name })),
        };
      });
    },

    // ------------------------------------------------------------ deletion

    /**
     * Marks the row deleted and nothing else: from now on every lookup above treats it as absent. Once only; a
     * later call changes nothing. A deletion goes through takeDown; this is the state a take-down that stopped
     * after the mark would leave, which finishTakeDown completes.
     */
    async markDeleted(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
    },

    /**
     * Step 1 of a deletion (1b design, section 7.6) in one transaction: the row is marked deleted, every live
     * session revoked, every device, code and passkey deleted, the WebAuthn user handle cleared, the account's staff
     * keys and staff sessions revoked, its enrolment links deleted and its keys blanked (3a design, section 7), and the
     * account_deleted event appended; last, the audit rows of the staff side, with the account as their actor, since its
     * owner asked for the deletion. Either all of it lands or none of it does, so a failure leaves a live account with its
     * sessions, never a deleted one with sessions, devices, passkeys or staff keys that nothing would remove. Answers the
     * ids of the sessions it revoked, for the cache tombstones, which are not the database's to write.
     */
    async takeDown(userId: string, now: Date, deviceId: string | null): Promise<string[]> {
      return db.transaction(async (tx) => {
        await tx.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
        const taken = await takeDownRows(tx, userId, now);
        await tx.insert(authEvents).values({ userId, type: "account_deleted", deviceId, metadata: {} });
        await appendTakeDownAudit(tx, userId, userId, taken.staff);
        return taken.sessionIds;
      });
    },

    /**
     * The rows of step 1 again (the sessions, devices, codes and passkeys, the WebAuthn user handle and the staff rows), for
     * a row marked deleted and not purged yet: a take-down that stopped after the mark, or a session that a sign-in already
     * past its lookup created after it. Nothing for a live or a purged row. The account_deleted event is not appended
     * again: the confirmation that recorded it is the only one there was. The staff side's audit rows are written, last,
     * for what this run revoked, with the server as their actor: the purge job finishes the take-down, no person.
     */
    async finishTakeDown(userId: string, now: Date): Promise<string[]> {
      return db.transaction(async (tx) => {
        // The account's row first, as every writer of staff rows takes it (3a design, section 7).
        const [row] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)))
          .for("no key update");
        if (!row) return [];
        const taken = await takeDownRows(tx, userId, now);
        await appendTakeDownAudit(tx, SYSTEM_ACTOR_ID, userId, taken.staff);
        return taken.sessionIds;
      });
    },

    /** Deleted accounts whose row the purge has not anonymised yet, oldest deletion first, at most 100 a round. */
    async pendingPurges(): Promise<string[]> {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(isNotNull(users.deletedAt), isNull(users.purgedAt)))
        .orderBy(users.deletedAt, users.id)
        .limit(100);
      return rows.map((r) => r.id);
    },

    /**
     * The last step of a deletion: the address becomes deleted:<id> (unique, and never a real address),
     * every credential and personal fact is cleared, and purged_at says it is done. Only a deleted row
     * not purged yet is written, so a second call, or a call for a live account, changes nothing.
     */
    async finishPurge(userId: string, now: Date): Promise<void> {
      await db
        .update(users)
        .set({
          email: `deleted:${userId}`,
          emailVerifiedAt: null,
          passwordHash: null,
          totpSecretEnc: null,
          totpEnabledAt: null,
          recoveryCodesHash: [],
          phoneHash: null,
          ageConfirmedAt: null,
          termsVersion: null,
          termsAcceptedAt: null,
          purgedAt: now,
        })
        .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)));
    },

    // ------------------------------------------------------------ lockdown

    /**
     * The lockdown (1c design, sections 2 and 7.6) in one transaction, as takeDown is one: every live session
     * revoked, every device revoked (so the next sign-in on any of them counts as a new device), the password
     * cleared as setPasswordHash clears it, the passkeys in reach removed, two-factor turned off as disableTotp
     * does when it was enabled at or after `since`, and the caller's event appended with what was done. Either
     * all of it lands or none of it does: the link that started it is spent by then, so a lockdown that stopped
     * halfway could not be asked for again, and would be on no record. The user row is locked first, as takeDown
     * and a registration take it first, so none of the three can wait on another in a circle, and two-factor is
     * read from the locked row. Answers the ids of the sessions it revoked, for the cache tombstones, which are
     * not the database's to write.
     */
    async lockDown(userId: string, input: LockDownInput): Promise<LockDownOutcome> {
      return db.transaction(async (tx) => {
        // An account that is gone has no two-factor to clear; its rows, if any are left, are still locked down below.
        const [locked] = await tx
          .select({ totpEnabledAt: users.totpEnabledAt })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .for("update");
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: input.now })
          .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        await tx.update(devices).set({ revokedAt: input.now }).where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
        // The user's passkeys from `since` on, plus any of theirs the caller names; a named passkey of another account is not the caller's to remove and stays.
        const reach = input.passkeyIds.length > 0 ? or(gte(passkeys.createdAt, input.since), inArray(passkeys.id, [...input.passkeyIds])) : gte(passkeys.createdAt, input.since);
        const removed = await tx
          .delete(passkeys)
          .where(and(eq(passkeys.userId, userId), reach))
          .returning({ id: passkeys.id });
        const totpCleared = locked !== undefined && locked.totpEnabledAt !== null && locked.totpEnabledAt.getTime() >= input.since.getTime();
        await tx
          .update(users)
          .set({
            passwordHash: null,
            passwordChangedAt: input.now,
            failedLogins: 0,
            lockedUntil: null,
            ...(totpCleared ? { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] } : {}),
          })
          .where(eq(users.id, userId));
        const passkeysRemoved = removed.map((row) => row.id);
        await tx.insert(authEvents).values({
          userId,
          type: input.event.type,
          deviceId: input.event.deviceId,
          ipHash: input.event.ipHash,
          metadata: { ...input.event.metadata, passkeysRemoved, totpCleared, passwordCleared: true },
        });
        return { sessionIds: revoked.map((row) => row.id), passkeysRemoved, totpCleared };
      });
    },

    // ------------------------------------------------------------ email codes

    async createEmailCode(input: {
      flowId: string;
      email: string;
      userId: string | null;
      purpose: EmailCodePurpose;
      codeHash: string;
      expiresAt: Date;
      ipHash: string | null;
    }): Promise<void> {
      await db.insert(emailCodes).values(input);
    },

    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const [row] = await db.select().from(emailCodes).where(eq(emailCodes.flowId, flowId)).limit(1);
      return row;
    },

    /** Increments the attempt counter atomically and returns the new value. */
    async addCodeAttempt(id: string): Promise<number> {
      const [row] = await db
        .update(emailCodes)
        .set({ attempts: sql`${emailCodes.attempts} + 1` })
        .where(eq(emailCodes.id, id))
        .returning({ attempts: emailCodes.attempts });
      return row?.attempts ?? Number.MAX_SAFE_INTEGER;
    },

    /** Marks a code used. False when it was already used, so a code works exactly once. */
    async consumeEmailCode(id: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(emailCodes)
        .set({ consumedAt: now })
        .where(and(eq(emailCodes.id, id), isNull(emailCodes.consumedAt)))
        .returning({ id: emailCodes.id });
      return rows.length === 1;
    },

    // ------------------------------------------------------------ devices

    async findDevice(userId: string, deviceHash: string): Promise<DeviceRow | undefined> {
      const [row] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.userId, userId), eq(devices.deviceHash, deviceHash), isNull(devices.revokedAt)))
        .limit(1);
      return row;
    },

    /** The device by its row id, revoked or not: a session's device, whose platform names a passkey and whose label the passkey notices carry. */
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const [row] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
      return row;
    },

    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const [row] = await db.insert(devices).values(input).returning();
      return row!;
    },

    async touchDevice(id: string, ipHash: string | null, now: Date): Promise<void> {
      await db.update(devices).set({ lastSeenAt: now, ipHash }).where(eq(devices.id, id));
    },

    /** A revoked device no longer carries live sessions and counts as new at its next sign-in. */
    async revokeDevice(id: string, now: Date): Promise<void> {
      await db.update(devices).set({ revokedAt: now }).where(and(eq(devices.id, id), isNull(devices.revokedAt)));
    },

    /** The user's devices that are not revoked, oldest first, for the data export; a revoked one stands for nothing of the account's any more. */
    async listDevices(userId: string): Promise<{ label: string | null; platform: string; firstSeenAt: Date; lastSeenAt: Date }[]> {
      return db
        .select({ label: devices.label, platform: devices.platform, firstSeenAt: devices.firstSeenAt, lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .orderBy(devices.firstSeenAt, devices.id);
    },

    // ------------------------------------------------------------ sessions

    /**
     * A new session with the factors its sign-in proved (kind to epoch milliseconds from the flows' clock) and the passkey
     * that started it, if one did. The reauth time is the latest of the factors, which is what freshness is read from. A row
     * without factors, as migration 0010 left the sessions from before it, re-authenticates before its next sensitive action.
     */
    async createSession(input: {
      id: string;
      userId: string;
      deviceId: string;
      now: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      factors?: Record<string, number>;
      passkeyId?: string | null;
    }): Promise<void> {
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      await db.insert(sessions).values({
        id: input.id,
        userId: input.userId,
        deviceId: input.deviceId,
        createdAt: input.now,
        lastUsedAt: input.now,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        factors,
        passkeyId: input.passkeyId ?? null,
      });
    },

    /** A session counts only when neither it, its device nor its user is revoked, deleted or expired. */
    async findActiveSession(id: string, now: Date): Promise<ActiveSessionRow | undefined> {
      const [row] = await db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          deviceId: sessions.deviceId,
          role: users.role,
          onboardedAt: users.onboardedAt,
          totpEnabledAt: users.totpEnabledAt,
          reauthAt: sessions.reauthAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
          absoluteExpiresAt: sessions.absoluteExpiresAt,
          handle: sessions.handle,
          factors: sessions.factors,
          passkeyId: sessions.passkeyId,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(
          and(
            eq(sessions.id, id),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
            gt(sessions.absoluteExpiresAt, now),
            isNull(users.deletedAt),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1);
      return row;
    },

    async slideSession(id: string, expiresAt: Date, now: Date): Promise<void> {
      await db.update(sessions).set({ expiresAt, lastUsedAt: now }).where(eq(sessions.id, id));
    },

    /**
     * Records a factor the session proved at `at`: the kind's time is set or replaced, and reauth_at, the latest of
     * them, follows the write. The flows always pass their clock's now.
     */
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      await db
        .update(sessions)
        .set({ factors: sql`${sessions.factors} || ${JSON.stringify({ [kind]: at.getTime() })}::jsonb`, reauthAt: at })
        .where(eq(sessions.id, id));
    },

    /**
     * Replaces the session's id, the token's hash, and nothing else, for a live session only: the handle, factors, reauth
     * time, passkey, device and expiries stay. False when the session is revoked or gone, so a rotation never revives one.
     * Nothing references sessions.id, so the primary key changes in place.
     */
    async rotateSession(id: string, newId: string): Promise<boolean> {
      const rows = await db
        .update(sessions)
        .set({ id: newId })
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length === 1;
    },

    /**
     * Revokes one session of this user, named by its handle: the id a rotation keeps, so a session listed before its
     * token rotated is still found. Answers the row's id as it is now, which its cached copy is keyed by; undefined
     * when the session does not belong to the user or is already revoked.
     */
    async revokeSession(handle: string, userId: string, now: Date): Promise<string | undefined> {
      const [row] = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.handle, handle), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return row?.id;
    },

    /** Revokes every live session of the user and returns their ids (for cache invalidation). */
    async revokeAllSessions(userId: string, now: Date): Promise<string[]> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.map((r) => r.id);
    },

    async listActiveSessions(userId: string, now: Date): Promise<SessionListRow[]> {
      return db
        .select({
          id: sessions.id,
          handle: sessions.handle,
          deviceLabel: devices.label,
          platform: devices.platform,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
        })
        .from(sessions)
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.absoluteExpiresAt, now)))
        .orderBy(desc(sessions.lastUsedAt));
    },

    // ------------------------------------------------------------ passkeys

    /**
     * The account's WebAuthn user handle, set to `candidate` when there is none yet (1c design, section 6): a
     * compare-and-set in one statement, so two registrations at once end with the same handle, whichever wrote it.
     * Undefined for an account that is gone.
     */
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      const [row] = await db
        .update(users)
        .set({ webauthnUserId: sql`coalesce(${users.webauthnUserId}, ${candidate})` })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning({ webauthnUserId: users.webauthnUserId });
      return row?.webauthnUserId ?? undefined;
    },

    async countPasskeys(userId: string): Promise<number> {
      const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, userId));
      return row?.count ?? 0;
    },

    /** The account's passkeys newest first, each with the label of the device that added it, for the Security list and the options' exclusions. */
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      return db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(eq(passkeys.userId, userId))
        .orderBy(desc(passkeys.createdAt), desc(passkeys.id));
    },

    /** One passkey of the account, with its device's label. Undefined when it is another account's or gone, which the flows do not tell apart. */
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const [row] = await db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * The passkey a sign-in's credential id names, whichever account it belongs to (1c design, section 7.4): the assertion
     * says nothing about the account, so the flow finds the owner from here. Undefined for an unknown credential; the flow
     * then reads the owner and refuses a deleted one, so a gone account never signs in.
     */
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)).limit(1);
      return row;
    },

    /**
     * A passkey the session's account holds, by credential id (1c design, section 7.2): the re-authentication looks it up
     * with the session's user, so another account's passkey and an unknown one are alike undefined and never re-authenticate.
     */
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db
        .select()
        .from(passkeys)
        .where(and(eq(passkeys.credentialId, credentialId), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * Writes a verified passkey's use in one conditional update (1c design, section 2), in the pattern of claimTotpStep: the
     * new counter, the use time and the current backup state, only for a passkey that is not suspect and whose counter moved
     * forward (two zeros, as synced passkeys always send, pass repeatedly). False when it matched no row, which the flow
     * reads, after a verified signature, as a counter regression or a race lost to one.
     */
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, now: Date): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ counter: newCounter, lastUsedAt: now, backedUp })
        .where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt), sql`((${newCounter} = 0 and ${passkeys.counter} = 0) or ${newCounter} > ${passkeys.counter})`))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /** Marks a passkey suspect once (1c design, section 2), so a later sign-in with it is refused; a second call changes nothing. */
    async suspectPasskey(id: string, now: Date): Promise<void> {
      await db.update(passkeys).set({ suspectAt: now }).where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt)));
    },

    /** The daily bound's reading for the options step; the registration's transaction reads it again. */
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(db, userId, withinMs, limit);
    },

    /**
     * A registration's transaction (1c design, section 7.3): the user row locked `for update`, so two registrations of one
     * account run one after the other and the later one sees what the earlier committed; both bounds checked again there;
     * then the passkey and its passkey_added event, or neither. A credential id already held raises the driver's unique
     * violation, which the flow reports as passkey_invalid.
     */
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      return db.transaction(async (tx): Promise<AddPasskeyOutcome> => {
        const [locked] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
          .for("update");
        if (!locked) return { ok: false, reason: "gone" };
        const [held] = await tx.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, input.userId));
        if ((held?.count ?? 0) >= limits.passkeys) return { ok: false, reason: "cap" };
        const additions = await recentPasskeyAdditions(tx, input.userId, limits.windowMs, limits.additions);
        if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
        const [passkey] = await tx.insert(passkeys).values(input).returning();
        await tx.insert(authEvents).values({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey!.id } });
        return { ok: true, passkey: passkey! };
      });
    },

    /** Renames one passkey of the account. False when it is another account's or gone. */
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ name })
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /**
     * Removes one passkey of the account and answers its name, for the notice; undefined when it is another account's or
     * gone. The sessions it started keep running without it: the foreign key sets their passkey_id to null.
     */
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const [row] = await db
        .delete(passkeys)
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ name: passkeys.name });
      return row;
    },

    // ------------------------------------------------------------ staff keys and enrolments (3a design, section 7)

    /**
     * The enrolment whose token hashes to `tokenHash`, used or not, expired or not, with what the enrolment flow checks of
     * its account: whether it is live, staff and has a handle, and its WebAuthn user handle. Undefined for an unknown
     * token. The flow decides; auth.add_staff_key decides again under the account's lock.
     */
    async findStaffEnrollment(tokenHash: string): Promise<StaffEnrollmentRow | undefined> {
      const [row] = await db
        .select({
          id: staffEnrollments.id,
          userId: staffEnrollments.userId,
          origin: staffEnrollments.origin,
          rpId: staffEnrollments.rpId,
          expiresAt: staffEnrollments.expiresAt,
          usedAt: staffEnrollments.usedAt,
          email: users.email,
          role: users.role,
          deletedAt: users.deletedAt,
          onboardedAt: users.onboardedAt,
          webauthnUserId: users.webauthnUserId,
        })
        .from(staffEnrollments)
        .innerJoin(users, eq(users.id, staffEnrollments.userId))
        .where(eq(staffEnrollments.tokenHash, tokenHash))
        .limit(1);
      return row;
    },

    /**
     * The account's live staff keys as an options list excludes them: an authenticator keeps one discoverable credential
     * per relying party and user handle, so a revoked key is left out and the same security key can be enrolled again.
     */
    async listLiveStaffKeys(userId: string): Promise<{ credentialId: string; transports: string[] }[]> {
      return db
        .select({ credentialId: staffKeys.credentialId, transports: staffKeys.transports })
        .from(staffKeys)
        .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
        .orderBy(staffKeys.createdAt, staffKeys.id);
    },

    /** One staff key as the console shows it: never its public key, credential id or AAGUID. */
    async findStaffKey(id: string): Promise<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null } | undefined> {
      const [row] = await db
        .select({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt, lastUsedAt: staffKeys.lastUsedAt })
        .from(staffKeys)
        .where(eq(staffKeys.id, id))
        .limit(1);
      return row;
    },

    /**
     * The enrolment's write, in one transaction on the auth role (3a design, section 7): the account's row locked first,
     * FOR NO KEY UPDATE, so a role change or take-down that holds it either committed before (and deleted the link, which
     * the function then does not find) or waits until this commits; the staff_key_added event; and last
     * auth.add_staff_key, which re-checks under that lock that the link is unused and unexpired and the account live,
     * staff, with a handle and fewer than five live keys, then spends the link, stores the key with the origin and relying
     * party ID the link recorded and writes its audit row, which holds the chain's head until the commit. A refusal by the
     * function rolls the event back with it. A credential id already held raises the driver's unique violation, which the
     * flow reports.
     */
    async addStaffKey(input: NewStaffKey): Promise<AddStaffKeyOutcome> {
      try {
        return await db.transaction(async (tx) => {
          await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("no key update");
          await tx.insert(authEvents).values({ userId: input.userId, type: "staff_key_added", metadata: { enrollmentId: input.enrollmentId } });
          // Each transport as its own parameter: an empty list is an empty array.
          const transports = sql`array[${sql.join(input.transports.map((t) => sql`${t}`), sql`, `)}]::text[]`;
          const [row] = await tx.execute<{ id: string }>(
            sql`select auth.add_staff_key(${input.token}::text, ${input.credentialId}::text, ${input.publicKey}::text, ${input.counter}::bigint,
              ${transports}, ${input.name}::text, ${input.aaguid}::uuid, ${input.requestId}::text) as id`,
          );
          return { ok: true as const, keyId: row!.id };
        });
      } catch (err) {
        // The function raises its refusal's staff code as the message.
        const refusal = raisedMessage(err);
        if (refusal === "staff_enrollment_invalid") return { ok: false, reason: "enrollment_invalid" };
        if (refusal === "staff_key_limit") return { ok: false, reason: "limit" };
        throw err;
      }
    },

    // ------------------------------------------------------------ staff sessions

    /** A staff key by its credential id, revoked or not, with its account's address, role, deletion and user handle; the sign-in decides. */
    async findStaffKeyForSignIn(credentialId: string): Promise<StaffKeyForSignIn | undefined> {
      const [row] = await db
        .select({
          id: staffKeys.id,
          userId: staffKeys.userId,
          credentialId: staffKeys.credentialId,
          publicKey: staffKeys.publicKey,
          transports: staffKeys.transports,
          name: staffKeys.name,
          revokedAt: staffKeys.revokedAt,
          origin: staffKeys.origin,
          rpId: staffKeys.rpId,
          email: users.email,
          role: users.role,
          deletedAt: users.deletedAt,
          webauthnUserId: users.webauthnUserId,
        })
        .from(staffKeys)
        .innerJoin(users, eq(users.id, staffKeys.userId))
        .where(eq(staffKeys.credentialId, credentialId))
        .limit(1);
      return row;
    },

    /**
     * A staff sign-in's write, in one transaction (3a design, section 7): first 1c's counter rule as one conditional update
     * of the key, which records its use only while it is live and its counter moved forward (two zeros pass, as some
     * authenticators always report 0); then the session, its staff_sign_in event and last its audit row, which holds the
     * chain's head until the commit. Null when the update matched no row: a counter that went backwards, or a key revoked
     * since the flow read it, which the caller tells apart. The update holds the key's row until the commit, so a
     * revocation waiting for it then also finds the session this opened.
     */
    async openStaffSession(input: NewStaffSession): Promise<{ handle: string } | null> {
      return db.transaction(async (tx) => {
        if (!(await recordStaffKeyUse(tx, input))) return null;
        const [session] = await tx
          .insert(staffSessions)
          .values({
            id: input.id,
            userId: input.userId,
            keyId: input.keyId,
            createdAt: input.now,
            lastUsedAt: input.now,
            idleExpiresAt: input.idleExpiresAt,
            absoluteExpiresAt: input.absoluteExpiresAt,
            browser: input.browser,
          })
          .returning({ handle: staffSessions.handle });
        const handle = session!.handle;
        await tx.insert(authEvents).values({ userId: input.userId, type: "staff_sign_in", ipHash: input.ipHash, metadata: { keyId: input.keyId, handle } });
        await appendAudit(tx, {
          actorId: input.userId,
          action: "staff_sign_in",
          targetType: "staff_session",
          targetId: handle,
          staffSession: handle,
          keyId: input.keyId,
          metadata: {},
          requestId: input.requestId,
        });
        return { handle };
      });
    },

    /**
     * A staff session by its token's hash, read from the database on every request, never cached (3a design, section 7):
     * one indexed read joined to its key and its account. It counts only while it is unrevoked, has started (a created_at
     * later than now is a row written behind the flows' back) and is before both its ends, its key unrevoked and its account
     * live and still staff, so a revocation, a demotion, a deletion or a suspect key ends it at its next request with no
     * tombstone. With `slideTo` (a request its person's action started) the same statement moves last_used_at to now and the
     * idle end to `slideTo`, never past the absolute end; without, nothing moves.
     */
    async resolveStaffSession(id: string, now: Date, slideTo: Date | null): Promise<StaffSessionRow | undefined> {
      const live = and(
        eq(staffSessions.id, id),
        isNull(staffSessions.revokedAt),
        lte(staffSessions.createdAt, now),
        gt(staffSessions.idleExpiresAt, now),
        gt(staffSessions.absoluteExpiresAt, now),
        isNull(staffKeys.revokedAt),
        isNull(users.deletedAt),
        ne(users.role, "user"),
      );
      const columns = {
        id: staffSessions.id,
        handle: staffSessions.handle,
        userId: staffSessions.userId,
        keyId: staffSessions.keyId,
        role: users.role,
        createdAt: staffSessions.createdAt,
        lastUsedAt: staffSessions.lastUsedAt,
        idleExpiresAt: staffSessions.idleExpiresAt,
        absoluteExpiresAt: staffSessions.absoluteExpiresAt,
        browser: staffSessions.browser,
      };
      if (slideTo === null) {
        const [row] = await db
          .select(columns)
          .from(staffSessions)
          .innerJoin(staffKeys, eq(staffKeys.id, staffSessions.keyId))
          .innerJoin(users, eq(users.id, staffSessions.userId))
          .where(live)
          .limit(1);
        return row;
      }
      const [row] = await db
        .update(staffSessions)
        // least() on the row's own absolute end, so the idle end never passes it, as the table's check also requires.
        .set({ lastUsedAt: now, idleExpiresAt: sql`least(${slideTo.toISOString()}::timestamptz, ${staffSessions.absoluteExpiresAt})` })
        .from(staffKeys)
        // A join in UPDATE ... FROM cannot name the updated table, so the account is reached through the key, whose owner
        // the sessions' foreign key on (key_id, user_id) makes the session's account.
        .innerJoin(users, eq(users.id, staffKeys.userId))
        .where(and(eq(staffKeys.id, staffSessions.keyId), live))
        .returning(columns);
      return row;
    },

    /** The account's live staff sessions, the same tests as resolveStaffSession's, most recently used first. */
    async listStaffSessions(userId: string, now: Date): Promise<{ handle: string; browser: string; createdAt: Date; lastUsedAt: Date }[]> {
      return db
        .select({ handle: staffSessions.handle, browser: staffSessions.browser, createdAt: staffSessions.createdAt, lastUsedAt: staffSessions.lastUsedAt })
        .from(staffSessions)
        .innerJoin(staffKeys, eq(staffKeys.id, staffSessions.keyId))
        .where(
          and(
            eq(staffSessions.userId, userId),
            isNull(staffSessions.revokedAt),
            lte(staffSessions.createdAt, now),
            gt(staffSessions.idleExpiresAt, now),
            gt(staffSessions.absoluteExpiresAt, now),
            isNull(staffKeys.revokedAt),
          ),
        )
        .orderBy(desc(staffSessions.lastUsedAt), desc(staffSessions.createdAt));
    },

    /** The account's live staff keys as the console lists them, oldest first: never a public key, a credential id or an AAGUID. */
    async listStaffKeyViews(userId: string): Promise<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null }[]> {
      return db
        .select({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt, lastUsedAt: staffKeys.lastUsedAt })
        .from(staffKeys)
        .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
        .orderBy(asc(staffKeys.createdAt), asc(staffKeys.id));
    },

    /**
     * A sign-out (3a design, section 7) in one transaction: the session revoked, if it still is live, then its
     * staff_signed_out event and last its audit row. False when another request ended it first, which writes nothing.
     */
    async endStaffSession(input: { id: string; userId: string; keyId: string; now: Date; ipHash: string | null; requestId: string }): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [ended] = await tx
          .update(staffSessions)
          .set({ revokedAt: input.now })
          .where(and(eq(staffSessions.id, input.id), eq(staffSessions.userId, input.userId), isNull(staffSessions.revokedAt)))
          .returning({ handle: staffSessions.handle });
        if (!ended) return false;
        await tx.insert(authEvents).values({ userId: input.userId, type: "staff_signed_out", ipHash: input.ipHash, metadata: { handle: ended.handle } });
        await appendAudit(tx, {
          actorId: input.userId,
          action: "staff_signed_out",
          targetType: "staff_session",
          targetId: ended.handle,
          staffSession: ended.handle,
          keyId: input.keyId,
          metadata: {},
          requestId: input.requestId,
        });
        return true;
      });
    },

    /** The staff key a step-up confirms with, revoked or not, by its id; the step-up decides. */
    async findStaffKeyCredential(id: string): Promise<StaffKeyCredential | undefined> {
      const [row] = await db
        .select({
          id: staffKeys.id,
          userId: staffKeys.userId,
          credentialId: staffKeys.credentialId,
          publicKey: staffKeys.publicKey,
          transports: staffKeys.transports,
          name: staffKeys.name,
          revokedAt: staffKeys.revokedAt,
          origin: staffKeys.origin,
          rpId: staffKeys.rpId,
        })
        .from(staffKeys)
        .where(eq(staffKeys.id, id))
        .limit(1);
      return row;
    },

    /**
     * The counter rule at a step-up (3a design, section 7), as at sign-in: the key's use is recorded only while it is live
     * and its counter moved forward. False when the update matched no row: a counter that went backwards, or a key
     * revoked since the step-up read it, which the caller hands to the counter rule's revocation.
     */
    async recordStaffKeyUse(input: { keyId: string; userId: string; newCounter: number; now: Date }): Promise<boolean> {
      return recordStaffKeyUse(db, input);
    },

    /**
     * Revokes one of the account's own live staff sessions, confirmed by a step-up, in one transaction on the auth role
     * (3a design, section 7). The account's row is locked first, FOR NO KEY UPDATE, as every revocation takes it, so a
     * revocation of the confirming key, a demotion or a take-down either committed before (and this refuses: the session
     * that confirmed has ended) or waits until this commits. Then the session, only where revoked_at is still null and
     * before both its ends, and only if it is the account's own; its staff_session_revoked event; and last its audit row,
     * through auth.append_audit, with the action's hash, its params in the metadata, the key and the assertion, which
     * audit-verify checks. "ended" when the confirming key or account no longer opens anything, "not_found" when the
     * handle names no live session of the account; neither writes anything.
     *
     * audit-verify refuses for good a row stamped at or after its challenge's expiry, and the trigger stamps the row only
     * once it holds the audit head, so a head held open would otherwise let a genuine confirmation become such a row. Every
     * lock wait here is therefore bounded by a third of the challenge's life left by the database's clock (at most 15
     * seconds), and the statement that writes the row also checks the database's clock against the expiry: "late" when a
     * wait gave up or the expiry came first, which rolls everything back and writes nothing.
     */
    async revokeConfirmedStaffSession(input: ConfirmedStaffSessionRevocation): Promise<"revoked" | "ended" | "not_found" | "late"> {
      try {
        return await db.transaction(async (tx) => {
          if (!(await boundLockWaits(tx, input.expiresAt))) return "late";
          return revokeConfirmedIn(tx, input);
        });
      } catch (err) {
        if (err instanceof LateConfirmation || isLockNotAvailable(err)) return "late";
        throw err;
      }
    },

    /**
     * Revokes staff keys in one transaction on the auth role (3a design, section 7): `staff.js revoke <email> <key id>` and
     * `revoke <email> all`, and the counter rule's revocation, which is the same routine with suspect_at set as well and the
     * regression's own event. The account's row is locked first, FOR NO KEY UPDATE, as every writer of staff rows takes it.
     * Then the keys (one, or every live one), each only where revoked_at is still null, since a set one is never changed;
     * then every staff session they opened (for `all`, every staff session of the account), after the keys, so a session a
     * sign-in opened while this waited for a key's row is found too; for `all`, the unused enrolment links; an event per key;
     * and last the audit rows, a key's revocation each and, when a link went, one staff_enrollments_cancelled row, so it
     * never changes the database without a row. The command line waits at most 10 seconds for a lock.
     */
    async revokeStaffKeys(input: StaffKeyRevocation): Promise<StaffKeysRevoked> {
      return db.transaction(async (tx): Promise<StaffKeysRevoked> => {
        if (input.via === "cli") await tx.execute(sql`set local lock_timeout = '10s'`);
        const [account] = await tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(and("id" in input.account ? eq(users.id, input.account.id) : sql`lower(${users.email}) = lower(${input.account.email})`, isNull(users.deletedAt)))
          .limit(1)
          .for("no key update");
        if (!account) return { ok: false, reason: "no_account" };
        let alreadyRevokedAt: Date | null = null;
        if (input.key !== "all") {
          // Another account's key and an unknown one are alike: neither is this account's to revoke.
          const [key] = await tx
            .select({ revokedAt: staffKeys.revokedAt })
            .from(staffKeys)
            .where(and(eq(staffKeys.id, input.key), eq(staffKeys.userId, account.id)));
          if (!key) return { ok: false, reason: "no_key" };
          alreadyRevokedAt = key.revokedAt;
        }
        const revoked = await tx
          .update(staffKeys)
          .set(input.suspect ? { revokedAt: input.now, suspectAt: input.now } : { revokedAt: input.now })
          .where(and(eq(staffKeys.userId, account.id), input.key === "all" ? undefined : eq(staffKeys.id, input.key), isNull(staffKeys.revokedAt)))
          .returning({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt });
        // An update answers in no set order; the events, rows and mail list the keys oldest first.
        revoked.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
        const keyIds = revoked.map((key) => key.id);
        const sessionsOf = input.key === "all" ? eq(staffSessions.userId, account.id) : keyIds.length > 0 ? inArray(staffSessions.keyId, keyIds) : null;
        const ended =
          sessionsOf === null
            ? []
            : await tx
                .update(staffSessions)
                .set({ revokedAt: input.now })
                .where(and(sessionsOf, isNull(staffSessions.revokedAt)))
                .returning({ keyId: staffSessions.keyId });
        const enrollmentsCancelled =
          input.key === "all"
            ? (
                await tx
                  .delete(staffEnrollments)
                  .where(and(eq(staffEnrollments.userId, account.id), isNull(staffEnrollments.usedAt)))
                  .returning({ id: staffEnrollments.id })
              ).length
            : 0;
        const action = input.suspect ? "staff_key_counter_regression" : "staff_key_revoked";
        const keys = revoked.map((key) => ({ id: key.id, name: key.name, sessionsRevoked: ended.filter((session) => session.keyId === key.id).length }));
        for (const key of keys) {
          // The key's id and no name: the take-down blanks names, and nothing can blank them in an event.
          await tx.insert(authEvents).values({ userId: account.id, type: action, metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via: input.via } });
        }
        for (const key of keys) {
          await appendAudit(tx, {
            actorId: input.actorId,
            action,
            targetType: "staff_key",
            targetId: key.id,
            metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via: input.via },
            requestId: input.requestId ?? null,
          });
        }
        if (enrollmentsCancelled > 0) {
          await appendAudit(tx, {
            actorId: input.actorId,
            action: "staff_enrollments_cancelled",
            targetType: "user",
            targetId: account.id,
            metadata: { count: enrollmentsCancelled, via: input.via },
            requestId: input.requestId ?? null,
          });
        }
        return { ok: true, userId: account.id, email: account.email, keys, staffSessionsRevoked: ended.length, enrollmentsCancelled, alreadyRevokedAt };
      });
    },

    // ------------------------------------------------------------ events

    async appendEvent(input: {
      userId: string | null;
      type: AuthEventType;
      deviceId?: string | null;
      ipHash?: string | null;
      metadata?: Record<string, unknown>;
    }): Promise<void> {
      await db.insert(authEvents).values({
        userId: input.userId,
        type: input.type,
        deviceId: input.deviceId ?? null,
        ipHash: input.ipHash ?? null,
        metadata: input.metadata ?? {},
      });
    },

    // ------------------------------------------------------------ retention

    /** Codes consumed or expired before `before` are of no use to anyone; they still hold an email and an ip hash. */
    async purgeEmailCodes(before: Date): Promise<number> {
      const rows = await db
        .delete(emailCodes)
        .where(or(and(sql`${emailCodes.consumedAt} is not null`, lt(emailCodes.consumedAt, before)), lt(emailCodes.expiresAt, before)))
        .returning({ id: emailCodes.id });
      return rows.length;
    },

    /** Sessions revoked or expired before `before`. Live ones are never touched. */
    async purgeSessions(before: Date): Promise<number> {
      const rows = await db
        .delete(sessions)
        .where(or(and(sql`${sessions.revokedAt} is not null`, lt(sessions.revokedAt, before)), lt(sessions.expiresAt, before), lt(sessions.absoluteExpiresAt, before)))
        .returning({ id: sessions.id });
      return rows.length;
    },

    /**
     * Staff sessions revoked or expired before `before` (3a design, section 7). A live one is never touched: both its ends
     * lie ahead. The audit rows that name a session keep its handle, which needs no row.
     */
    async purgeStaffSessions(before: Date): Promise<number> {
      const rows = await db
        .delete(staffSessions)
        .where(
          or(
            and(isNotNull(staffSessions.revokedAt), lt(staffSessions.revokedAt, before)),
            lt(staffSessions.idleExpiresAt, before),
            lt(staffSessions.absoluteExpiresAt, before),
          ),
        )
        .returning({ id: staffSessions.id });
      return rows.length;
    },

    /** Enrolment links used or expired before `before`, which can enrol nothing more; one that still can is cancelled only by name. */
    async purgeStaffEnrollments(before: Date): Promise<number> {
      const rows = await db
        .delete(staffEnrollments)
        .where(or(and(isNotNull(staffEnrollments.usedAt), lt(staffEnrollments.usedAt, before)), lt(staffEnrollments.expiresAt, before)))
        .returning({ id: staffEnrollments.id });
      return rows.length;
    },

    /** The design's IP-hash purge: a device not seen since `before` keeps no address hash. */
    async purgeDeviceIpHashes(before: Date): Promise<number> {
      const rows = await db
        .update(devices)
        .set({ ipHash: null })
        .where(and(sql`${devices.ipHash} is not null`, lt(devices.lastSeenAt, before)))
        .returning({ id: devices.id });
      return rows.length;
    },

    /**
     * Events older than `days` days, through auth.purge_events (migration 0007): the table stays
     * append-only for this role, which holds no DELETE on it; the function is owned by the migrator.
     */
    async purgeEvents(days: number): Promise<number> {
      const [row] = (await db.execute(sql`select auth.purge_events(make_interval(days => ${days}::int)) as removed`)) as unknown as { removed: number }[];
      return Number(row?.removed ?? 0);
    },

    async recentEvents(userId: string, limit = 20) {
      return db
        .select({ type: authEvents.type, deviceId: authEvents.deviceId, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(eq(authEvents.userId, userId))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id))
        .limit(limit);
    },

    /** The user's own events since `since`, newest first, for the data export: their kind and time, never the metadata. */
    async eventsSince(userId: string, since: Date): Promise<{ type: AuthEventType; createdAt: Date }[]> {
      return db
        .select({ type: authEvents.type, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(and(eq(authEvents.userId, userId), gte(authEvents.createdAt, since)))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id));
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** What a read runs through: the pool, or a transaction that needs the read to see its own lock. */
type Querier = Pick<Db, "select">;

/** The auth side's actions in the audit log: the only ones auth.append_audit writes (migration 0012). */
type AuthAuditAction =
  | "staff_key_revoked"
  | "staff_key_counter_regression"
  | "staff_sign_in"
  | "staff_signed_out"
  | "staff_session_revoked"
  | "staff_enrollments_cancelled"
  | "role_granted";

/** One auth-side row of the audit log. The trigger sets its id, time, place and hashes. */
interface AuthAuditRow {
  actorId: string;
  action: AuthAuditAction;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  staffSession?: string | null;
  keyId?: string | null;
  actionHash?: string | null;
  stepUp?: { authenticatorData: string; clientDataJSON: string; signature: string } | null;
  requestId?: string | null;
}

/**
 * Writes an auth-side row of the audit log in the caller's transaction, through auth.append_audit: the auth role holds
 * nothing in the public schema, and the function, which the migrator owns, writes only the auth side's actions (3a design,
 * section 6). It must be the transaction's last statement: the row holds the chain's head until the commit, so nothing that
 * can wait may run after it. Answers the row's place in the chain.
 */
async function appendAudit(tx: Tx, row: AuthAuditRow): Promise<number> {
  // The jsonb arguments go as text and are cast, so postgres.js sends them exactly as serialised here.
  const stepUp = row.stepUp ? JSON.stringify(row.stepUp) : null;
  const [written] = await tx.execute<{ place: string }>(
    sql`select auth.append_audit(${row.actorId}::uuid, ${row.action}::text, ${row.targetType}::text, ${row.targetId}::text,
      ${JSON.stringify(row.metadata)}::text::jsonb, ${row.staffSession ?? null}::uuid, ${row.keyId ?? null}::uuid,
      ${row.actionHash ?? null}::text, ${stepUp}::text::jsonb, ${row.requestId ?? null}::text)::text as place`,
  );
  return Number(written!.place);
}

/**
 * A confirmed action whose row could not join the chain before its step-up challenge expired; nothing was written.
 * Exported for the step-up suite, which runs revokeConfirmedIn past its challenge's expiry and expects this.
 */
export class LateConfirmation extends Error {
  constructor() {
    super("the confirmation's row could not join the chain before its challenge expired");
    this.name = "LateConfirmation";
  }
}

/** True for PostgreSQL's lock_not_available (a lock_timeout ran out), however deeply the driver wrapped it. */
function isLockNotAvailable(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "55P03") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Bounds every lock wait of a confirmed action's transaction (3a design, section 7, Step-up): lock_timeout becomes a third
 * of what is left of the challenge's life by the database's clock, at most 15 seconds, so the three waits it may meet (the
 * account's row, the session's row, the audit head) all end before the expiry. False when nothing is left, or less than a
 * millisecond, which lock_timeout would read as no limit at all.
 */
async function boundLockWaits(tx: Tx, expiresAt: Date): Promise<boolean> {
  const [left] = await tx.execute<{ ms: string }>(
    sql`select floor(least(15000, (${expiresAt.getTime()}::numeric - extract(epoch from clock_timestamp()) * 1000) / 3))::bigint::text as ms`,
  );
  const ms = Number(left!.ms);
  if (!(ms >= 1)) return false;
  await tx.execute(sql`select set_config('lock_timeout', ${`${ms}ms`}::text, true)`);
  return true;
}

/**
 * appendAudit for a row a step-up confirmed, in one statement that also reads the database's clock once the row is in the
 * chain: the trigger stamped the row no later than that, so a clock still before the challenge's expiry means the row is
 * too, as audit-verify requires. The audit row stays the last statement of its transaction. False when the expiry came
 * first: the caller then rolls the transaction back.
 */
async function appendAuditBefore(tx: Tx, expiresAt: Date, row: AuthAuditRow): Promise<boolean> {
  const stepUp = row.stepUp ? JSON.stringify(row.stepUp) : null;
  // A volatile function in a CTE is evaluated once, before the outer query reads its row, so the clock is read after it.
  const [written] = await tx.execute<{ inTime: boolean }>(
    sql`with written as (
      select auth.append_audit(${row.actorId}::uuid, ${row.action}::text, ${row.targetType}::text, ${row.targetId}::text,
        ${JSON.stringify(row.metadata)}::text::jsonb, ${row.staffSession ?? null}::uuid, ${row.keyId ?? null}::uuid,
        ${row.actionHash ?? null}::text, ${stepUp}::text::jsonb, ${row.requestId ?? null}::text) as place
    )
    select extract(epoch from clock_timestamp()) * 1000 < ${expiresAt.getTime()}::numeric as "inTime" from written`,
  );
  return written!.inTime === true;
}

/**
 * revokeConfirmedStaffSession's statements, in its transaction: the account's row first, then the key, the session, the
 * event, and last the audit row, written only while the challenge has not expired by the database's clock.
 *
 * Exported for the step-up suite alone, which runs it without boundLockWaits on a challenge already expired, as if the
 * waits had together outlasted it: that is the only way to reach the row's own clock check on cue, since the bound ends
 * any one wait the suite could hold before then. Everything else calls revokeConfirmedStaffSession.
 */
export async function revokeConfirmedIn(tx: Tx, input: ConfirmedStaffSessionRevocation): Promise<"revoked" | "ended" | "not_found"> {
  const [account] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, input.userId), isNull(users.deletedAt), ne(users.role, "user")))
    .limit(1)
    .for("no key update");
  if (!account) return "ended";
  const [key] = await tx
    .select({ id: staffKeys.id })
    .from(staffKeys)
    .where(and(eq(staffKeys.id, input.keyId), eq(staffKeys.userId, input.userId), isNull(staffKeys.revokedAt)));
  if (!key) return "ended";
  const [revoked] = await tx
    .update(staffSessions)
    .set({ revokedAt: input.now })
    .where(
      and(
        eq(staffSessions.handle, input.handle),
        eq(staffSessions.userId, input.userId),
        isNull(staffSessions.revokedAt),
        gt(staffSessions.idleExpiresAt, input.now),
        gt(staffSessions.absoluteExpiresAt, input.now),
      ),
    )
    .returning({ handle: staffSessions.handle });
  if (!revoked) return "not_found";
  // The account's own log names the session that ended and the one that ended it.
  await tx.insert(authEvents).values({ userId: input.userId, type: "staff_session_revoked", ipHash: input.ipHash, metadata: { handle: revoked.handle, by: input.staffSession } });
  const inTime = await appendAuditBefore(tx, input.expiresAt, {
    actorId: input.userId,
    action: "staff_session_revoked",
    targetType: "staff_session",
    targetId: revoked.handle,
    staffSession: input.staffSession,
    keyId: input.keyId,
    actionHash: input.actionHash,
    stepUp: input.stepUp,
    metadata: { params: input.params },
    requestId: input.requestId,
  });
  // Thrown, so the transaction rolls back: the session stays live and no row is written.
  if (!inTime) throw new LateConfirmation();
  return "revoked";
}

/**
 * 1c's counter rule as one conditional update of a staff key (3a design, section 7), at a sign-in in the session's
 * transaction and at a step-up on its own: the key's use and counter are recorded only while it is the account's, live, and
 * its counter moved forward (two zeros pass, as some authenticators always report 0). False when no row matched. The
 * update holds the key's row until the commit, so a revocation waiting for it then also finds what this transaction did.
 */
async function recordStaffKeyUse(q: Pick<Db, "update">, input: { keyId: string; userId: string; newCounter: number; now: Date }): Promise<boolean> {
  const claimed = await q
    .update(staffKeys)
    .set({ counter: input.newCounter, lastUsedAt: input.now })
    .where(
      and(
        eq(staffKeys.id, input.keyId),
        eq(staffKeys.userId, input.userId),
        isNull(staffKeys.revokedAt),
        sql`((${input.newCounter} = 0 and ${staffKeys.counter} = 0) or ${input.newCounter} > ${staffKeys.counter})`,
      ),
    )
    .returning({ id: staffKeys.id });
  return claimed.length > 0;
}

/**
 * The daily bound's reading (1c design, section 2): how many passkey_added events the account has within the window, at
 * most `limit` of them, and the seconds until the oldest of those is out of the window, when the day has a slot again.
 * Counted from the events, so a removal frees nothing, and by the database clock, which wrote them.
 */
async function recentPasskeyAdditions(q: Querier, userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
  const window = sql`make_interval(secs => ${withinMs / 1000}::float8)`;
  const recent = q
    .select({ createdAt: authEvents.createdAt })
    .from(authEvents)
    .where(and(eq(authEvents.userId, userId), eq(authEvents.type, "passkey_added"), gt(authEvents.createdAt, sql`now() - ${window}`)))
    .orderBy(desc(authEvents.createdAt))
    .limit(limit)
    .as("recent");
  const [row] = await q
    .select({
      count: sql<number>`count(*)::int`,
      retryAfterSeconds: sql<number>`coalesce(ceil(extract(epoch from (min(${recent.createdAt}) + ${window} - now())))::int, 0)`,
    })
    .from(recent);
  return { count: row?.count ?? 0, retryAfterSeconds: row?.retryAfterSeconds ?? 0 };
}

/** The message of an exception a PL/pgSQL function raised (SQLSTATE P0001), however deeply the driver wrapped it; null for anything else. */
function raisedMessage(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "P0001") {
      const message = (current as { message?: unknown }).message;
      return typeof message === "string" ? message : null;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** What revoking an account's staff access did, for the auth events already written, the audit rows and the mail. */
interface StaffRevocation {
  /** Each key revoked now, oldest first, with how many of its staff sessions were revoked now. */
  keys: { id: string; name: string; sessionsRevoked: number }[];
  staffSessionsRevoked: number;
  /**
   * The open enrolment links (never used) deleted now: the deletions that end something, and the count the record carries.
   * A spent link deleted with them at a take-down is not counted, since it could enrol nothing more and nothing was cancelled.
   */
  enrollmentsCancelled: number;
}

/**
 * Ends an account's staff access inside the caller's transaction, which has locked the account's row first (3a design,
 * section 7): when `keys` is set every live staff key is revoked, then every staff session not yet revoked, the
 * enrolment links deleted (the unused ones, or every one at a take-down), and a staff_key_revoked event for each key. The
 * keys go before the sessions, as in revokeStaffKeys: a sign-in holds its key's row from the moment it records the key's
 * use until it commits the session it opens, and the session's insert does not wait for the account's lock, so a session
 * opened while this waited for a key's row is committed by the time the sessions are revoked, and is found and counted.
 * A revocation sets revoked_at only where it is still null, since a set one is never changed. Writes no audit row: the
 * caller writes those last, after its own statements.
 */
async function revokeStaffAccess(
  tx: Tx,
  userId: string,
  now: Date,
  options: { keys: boolean; enrollments: "unused" | "all"; via: "role_change" | "take_down" },
): Promise<StaffRevocation> {
  const revoked = options.keys
    ? await tx
        .update(staffKeys)
        .set({ revokedAt: now })
        .where(and(eq(staffKeys.userId, userId), isNull(staffKeys.revokedAt)))
        .returning({ id: staffKeys.id, name: staffKeys.name, createdAt: staffKeys.createdAt })
    : [];
  const ended = await tx
    .update(staffSessions)
    .set({ revokedAt: now })
    .where(and(eq(staffSessions.userId, userId), isNull(staffSessions.revokedAt)))
    .returning({ keyId: staffSessions.keyId });
  const deleted = await tx
    .delete(staffEnrollments)
    .where(and(eq(staffEnrollments.userId, userId), options.enrollments === "unused" ? isNull(staffEnrollments.usedAt) : undefined))
    .returning({ usedAt: staffEnrollments.usedAt });
  const keys: StaffRevocation["keys"] = [];
  if (options.keys) {
    // An update answers in no set order; the events, rows and mail list the keys oldest first.
    revoked.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    for (const key of revoked) {
      const sessionsRevoked = ended.filter((session) => session.keyId === key.id).length;
      keys.push({ id: key.id, name: key.name, sessionsRevoked });
      // The key's id and no name: the take-down blanks names, and nothing can blank them in an event.
      await tx.insert(authEvents).values({ userId, type: "staff_key_revoked", metadata: { keyId: key.id, sessionsRevoked, via: options.via } });
    }
  }
  return { keys, staffSessionsRevoked: ended.length, enrollmentsCancelled: deleted.filter((link) => link.usedAt === null).length };
}

/** The audit row of each staff key a revocation revoked, in the order of its events; among the caller's last statements. */
async function appendKeyRevocations(tx: Tx, actorId: string, revocation: StaffRevocation, via: "role_change" | "take_down"): Promise<void> {
  for (const key of revocation.keys) {
    await appendAudit(tx, {
      actorId,
      action: "staff_key_revoked",
      targetType: "staff_key",
      targetId: key.id,
      metadata: { keyId: key.id, sessionsRevoked: key.sessionsRevoked, via },
    });
  }
}

/**
 * A take-down's audit rows, its transaction's last statements (3a design, section 7): each staff key's revocation and,
 * when an open enrolment link went, one staff_enrollments_cancelled row with their count, so the take-down never ends
 * any staff access without a row on the record. The spent links it deletes too are no cancellation, and like the
 * janitor's deletions of them they get no row. Nothing when the account had no staff access left to take.
 */
async function appendTakeDownAudit(tx: Tx, actorId: string, userId: string, revocation: StaffRevocation): Promise<void> {
  await appendKeyRevocations(tx, actorId, revocation, "take_down");
  if (revocation.enrollmentsCancelled > 0) {
    await appendAudit(tx, {
      actorId,
      action: "staff_enrollments_cancelled",
      targetType: "user",
      targetId: userId,
      metadata: { count: revocation.enrollmentsCancelled, via: "take_down" },
    });
  }
}

/**
 * The rows step 1 of a deletion takes down, inside the caller's transaction: every live session is revoked
 * (its id answered, for the cache tombstones), every device is deleted, and with it by cascade every session
 * row, every code out for the user goes, whatever its purpose, so none can complete a flow for an account
 * that is gone, and every passkey goes with the WebAuthn user handle (1c design, section 7.7), so a deleted
 * account keeps no credential of any kind and no assertion can name it again. Its staff access ends too (3a design,
 * section 7): its live staff keys and staff sessions are revoked, with a staff_key_revoked event per key, and its
 * enrolment links deleted. The keys themselves are never deleted, since audit-verify checks old confirmations against
 * them, so auth.forget_staff_keys blanks their names, AAGUIDs and transports and keeps what audit-verify needs. It writes
 * no audit row: the caller writes those last, from what this answers. Run again by finishTakeDown, each statement finds
 * nothing more to do.
 */
async function takeDownRows(tx: Tx, userId: string, now: Date): Promise<{ sessionIds: string[]; staff: StaffRevocation }> {
  const revoked = await tx
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  await tx.delete(devices).where(eq(devices.userId, userId));
  await tx.delete(emailCodes).where(eq(emailCodes.userId, userId));
  await tx.delete(passkeys).where(eq(passkeys.userId, userId));
  // The handle only ever named the account to its passkeys and staff keys; cleared here rather than by finishPurge, so the
  // take-down leaves nothing of the ceremony behind.
  await tx.update(users).set({ webauthnUserId: null }).where(eq(users.id, userId));
  const staff = await revokeStaffAccess(tx, userId, now, { keys: true, enrollments: "all", via: "take_down" });
  // The account is marked deleted by now, which the function checks: for a live account it would change nothing.
  await tx.execute(sql`select auth.forget_staff_keys(${userId}::uuid)`);
  return { sessionIds: revoked.map((row) => row.id), staff };
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
```

### Replace `apps/api/src/auth/staff/enroll.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import type { StaffEnrollOptionsRequest, StaffEnrollVerifyRequest, StaffEnrollVerifyResponse } from "@korbat/contracts";
import { AuthError, isUniqueViolation, type AuthDeps, type StaffRequestContext } from "../context";
import { sha256Hex } from "../crypto";
import { noticeTime, notifyAccount } from "../flows/notify";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "../passkeys/challenge";
import {
  readResponseChallenge,
  registrationOptions,
  verifyRegistration,
  type CredentialDescriptor,
  type PublicKeyCredentialCreationOptionsJSON,
} from "../passkeys/webauthn";
import type { StaffEnrollmentRow } from "../repo";

/**
 * Staff key enrolment (3a design, section 7, Enrolment). The link `staff.js enroll` printed carries a one-time token; the
 * console's enrolment page asks for the key's options with it, then hands the browser's answer back with it. The routes
 * live in the staff module, behind the staff gate; the credential work is here.
 */

/** The options as the library wrote them, which the contracts' StaffEnrollOptionsResponse passes through to the browser. */
export interface StaffEnrollOptions {
  options: PublicKeyCredentialCreationOptionsJSON;
  rpShared: boolean;
}

const enrollmentInvalid = () => new AuthError("staff_enrollment_invalid", 400);
/** Every refusal of the codec or the wrapper at enrolment: no staff answer carries a passkey_* code (3a design, section 10). */
const keyRefused = () => new AuthError("staff_key_refused", 400);

/** The console as the configuration sets it; the staff routes are mounted only while it is on, so its absence is a wiring fault. */
export function consoleOf(deps: AuthDeps): { origin: string; rpId: string } {
  if (!deps.config.console) throw new Error("the staff console is off: CONSOLE_ORIGIN is not set");
  return deps.config.console;
}

/**
 * Whether a staff key was enrolled for the console as it is configured now. A browser binds a credential to the relying
 * party ID, not the origin, so after the console moves to another port or scheme with the same relying party ID it still
 * offers the keys enrolled before; but audit-verify judges every confirmation against the origin and relying party ID
 * recorded on its key, and would refuse for good each one made at the new address. So such a key opens and confirms
 * nothing (the console's move means enrolling every key again), and the API and audit-verify judge every assertion by
 * the same values.
 */
export function enrolledHere(deps: AuthDeps, key: { origin: string; rpId: string }): boolean {
  const staffConsole = consoleOf(deps);
  return key.origin === staffConsole.origin && key.rpId === staffConsole.rpId;
}

/** Whether staff keys and personal passkeys share a relying party ID, as both are localhost in development (3a design, section 2). */
function sharedRelyingParty(deps: AuthDeps): boolean {
  return deps.config.console !== null && deps.config.console.rpId === deps.config.webauthn.rpId;
}

/**
 * The enrolment a link's token names, while it can still enrol a key: unused, unexpired by the flows' clock, issued for
 * the console as it is configured now (a link issued before the console moved would bind a key to the old address), and
 * for an account that is live, staff and has a handle. Anything else, an unknown token included, is one answer.
 * auth.add_staff_key checks all of it again under the account's lock, by the database's clock.
 */
async function liveEnrollment(deps: AuthDeps, token: string): Promise<StaffEnrollmentRow> {
  const staffConsole = consoleOf(deps);
  const enrollment = await deps.repo.findStaffEnrollment(sha256Hex(token));
  if (!enrollment) throw enrollmentInvalid();
  if (enrollment.usedAt !== null || enrollment.expiresAt.getTime() <= deps.now().getTime()) throw enrollmentInvalid();
  if (enrollment.origin !== staffConsole.origin || enrollment.rpId !== staffConsole.rpId) throw enrollmentInvalid();
  if (enrollment.deletedAt !== null || enrollment.role === "user" || enrollment.onboardedAt === null) throw enrollmentInvalid();
  return enrollment;
}

/** Runs one step of the codec or the wrapper, answering its passkey_* refusals with staff_key_refused; challenge_expired stays, and the console starts over on it. */
async function refusedAsStaff<T>(step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    if (err instanceof AuthError && (err.code === "passkey_invalid" || err.code === "passkey_unsupported")) throw keyRefused();
    throw err;
  }
}

/**
 * Registration options for a staff key: the console's relying party, the account's 1c user handle (set now with 1c's
 * compare-and-set when the account has none), the key's name as the only label the authenticator shows, user
 * verification and a resident key required, the pinned algorithms, and a staff registration challenge bound to the
 * enrolment's id. The account's live staff keys are excluded, and while the two relying party IDs are equal its personal
 * passkeys too, so an authenticator refuses rather than replacing one kind with the other under the same user handle. The
 * "Register a security key" button sends the security-key hint; "Use Windows Hello on this computer" sends none, since the
 * hint would hide Windows Hello. `rpShared` tells the page whether it may ask a password manager to drop a refused key.
 */
export async function enrollOptions(deps: AuthDeps, input: StaffEnrollOptionsRequest): Promise<StaffEnrollOptions> {
  const staffConsole = consoleOf(deps);
  const enrollment = await liveEnrollment(deps, input.token);
  // 32 random bytes, never the account id, set once: a passkey registration racing this one reads the same bytes back.
  const userHandle = enrollment.webauthnUserId ?? (await deps.repo.ensureWebauthnUserId(enrollment.userId, randomBytes(32)));
  if (!userHandle) throw enrollmentInvalid();
  const shared = sharedRelyingParty(deps);
  const exclude: CredentialDescriptor[] = (await deps.repo.listLiveStaffKeys(enrollment.userId)).map((k) => ({ id: k.credentialId, transports: k.transports }));
  if (shared) exclude.push(...(await deps.repo.listPasskeys(enrollment.userId)).map((p) => ({ id: p.credentialId, transports: p.transports })));
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "staff_register", deps.now(), enrollment.id);
  const options = await registrationOptions({
    rp: { id: staffConsole.rpId, name: deps.config.webauthn.rpName },
    // Never the email, the handle or the account id: the authenticator shows this name, and so does anyone who sees it.
    user: { id: userHandle, name: input.name, displayName: input.name },
    exclude,
    challenge,
    userVerification: "required",
    hint: input.kind === "security_key" ? "securityKey" : undefined,
  });
  return { options, rpShared: shared };
}

/**
 * Stores the staff key the browser created. The link is checked first, then the challenge is read from the response,
 * checked against the enrolment's id and spent before anything else runs, and the response verified against
 * CONSOLE_ORIGIN and CONSOLE_RP_ID alone; whatever the codec or the wrapper refuses is staff_key_refused. Only then are
 * the flags read, each refusal with its own code: a key that did not verify the user, or that reported backup
 * eligibility (it can be synced) or a backup. A refusal never spends the link, so the person can try another key until
 * it expires. The write is one transaction that ends in auth.add_staff_key; after the commit the owner is mailed.
 */
export async function enrollVerify(deps: AuthDeps, input: StaffEnrollVerifyRequest, ctx: StaffRequestContext): Promise<StaffEnrollVerifyResponse> {
  const staffConsole = consoleOf(deps);
  const enrollment = await liveEnrollment(deps, input.token);
  const now = deps.now();
  const key = challengeKey(deps.config.authHmacKey);
  const challenge = await refusedAsStaff(() => readResponseChallenge(input.response));
  await refusedAsStaff(() => readChallenge(key, challenge, "staff_register", now, enrollment.id));
  await refusedAsStaff(() => spendChallenge(deps.kv, challenge, now));
  const verified = await refusedAsStaff(() => verifyRegistration({ response: input.response, expectedChallenge: challenge, origins: [staffConsole.origin], rpId: staffConsole.rpId }));
  // After the library has verified, so each refusal is the authenticator's own claim about a key it really created.
  if (!verified.userVerified) throw new AuthError("staff_key_not_user_verified", 403);
  if (verified.backupEligible || verified.backedUp) throw new AuthError("staff_key_not_device_bound", 403);

  let outcome;
  try {
    outcome = await deps.repo.addStaffKey({
      userId: enrollment.userId,
      enrollmentId: enrollment.id,
      token: input.token,
      credentialId: verified.credentialId,
      publicKey: verified.publicKey,
      counter: verified.counter,
      transports: verified.transports,
      name: input.name,
      // Zeros when the authenticator or the browser withheld its model, which `staff.js keys` prints as such.
      aaguid: verified.aaguid,
      requestId: ctx.requestId,
    });
  } catch (err) {
    // A credential id korbat already holds as a staff key: the authenticator answered for a key that is not new.
    if (isUniqueViolation(err)) throw keyRefused();
    throw err;
  }
  if (!outcome.ok) throw outcome.reason === "limit" ? new AuthError("staff_key_limit", 409) : enrollmentInvalid();

  const stored = await deps.repo.findStaffKey(outcome.keyId);
  if (!stored) throw new Error(`the staff key ${outcome.keyId} was stored but cannot be read back`);
  // After the commit, and best effort as every notice is: a failed mail never undoes an enrolment.
  await notifyAccount(deps, enrollment.email, "staff_key_added", { name: stored.name, time: noticeTime(stored.createdAt) });
  return { key: { id: stored.id, name: stored.name, createdAt: stored.createdAt.toISOString(), lastUsedAt: stored.lastUsedAt?.toISOString() ?? null } };
}
```

### Replace `apps/api/src/auth/staff/signin.ts` (whole file)

```ts
import type { StaffMe, StaffRole, StaffSignInVerifyRequest } from "@korbat/contracts";
import { AuthError, type AuthDeps, type StaffRequestContext } from "../context";
import { deviceLabel } from "../devices";
import { noticeTime, notifyAccount } from "../flows/notify";
import { HOUR, enforceLimit } from "../limits";
import { challengeKey, issueChallenge, readChallenge, spendChallenge } from "../passkeys/challenge";
import { authenticationOptions, readResponseChallenge, verifyAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "../passkeys/webauthn";
import { consoleOf, enrolledHere } from "./enroll";
import { revokeForCounterRegression } from "./revoke";
import { openStaffSession, staffMe } from "./sessions";

/**
 * The staff sign-in (3a design, section 7, Sign-in). The console asks for options, the browser offers the staff keys it
 * holds for the console's relying party, and the answer opens a staff session. Only a live staff key of a live staff
 * account opens one, and only when its authenticator reported user verification and neither backup eligibility nor a
 * backup at this use. The routes live in the staff module, behind the staff gate; the credential work is here.
 */

/** Sign-in attempts per client address an hour, counted before anything else. */
export const STAFF_SIGNIN_PER_IP_PER_HOUR = 20;
/** Sign-ins per staff key an hour, counted only once its signature and flags have checked, so only its holder spends them. */
export const STAFF_SIGNIN_PER_KEY_PER_HOUR = 10;

/** The one answer for every failure up to and including the signature, so no answer tells a live key from a revoked or unknown one. */
const keyInvalid = () => new AuthError("staff_key_invalid", 401);

/** Runs one step of the codec or the wrapper, answering its passkey_* refusals with staff_key_invalid; challenge_expired stays, and the console starts over on it. */
async function invalidAsStaff<T>(step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    if (err instanceof AuthError && (err.code === "passkey_invalid" || err.code === "passkey_unsupported")) throw keyInvalid();
    throw err;
  }
}

/** What a sign-in hands the staff route: the session's token, for the cookie, and the answer /me would give. */
export interface StaffSignedIn {
  token: string;
  me: StaffMe;
}

/**
 * Options for a staff sign-in: an empty allow list, so the options name no account and the browser offers every
 * discoverable credential it holds for the console's relying party; user verification required; and a staff sign-in
 * challenge bound to nothing, which no other ceremony accepts. Handing them out stores nothing.
 */
export async function signInOptions(deps: AuthDeps): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  const staffConsole = consoleOf(deps);
  const challenge = issueChallenge(challengeKey(deps.config.authHmacKey), "staff_signin", deps.now());
  const options = await authenticationOptions({ rpId: staffConsole.rpId, allow: [], challenge, userVerification: "required" });
  return { options };
}

/**
 * Verifies a staff sign-in. The per-address limit is counted first. The challenge is read from the response and spent
 * before anything else runs, so a forged, foreign or spent one never reaches the library. Then the key must be a live
 * staff key of a live staff account, enrolled for the console as it is configured now (enrolledHere), and the response
 * must carry that account's user handle, since the allow list named no one (as 1c's sign-in requires). Every failure so
 * far, and a response the library refuses on its signature, its origin or its relying party (those recorded on the key,
 * which are CONSOLE_ORIGIN's and CONSOLE_RP_ID's), is staff_key_invalid. Only after the signature are the
 * flags read, each refusal with its own code; then the per-key limit is counted, so an unsigned response naming a key's
 * credential id cannot lock its owner out; then 1c's counter rule, in the session's own transaction, where a regression
 * revokes the key. The session is mailed to its owner after the commit.
 */
export async function signInVerify(deps: AuthDeps, input: StaffSignInVerifyRequest, ctx: StaffRequestContext): Promise<StaffSignedIn> {
  await enforceLimit(deps.kv, `staff-signin:ip:${ctx.ipHash}`, STAFF_SIGNIN_PER_IP_PER_HOUR, HOUR);
  const now = deps.now();
  const challenge = await invalidAsStaff(() => readResponseChallenge(input.response));
  await invalidAsStaff(() => readChallenge(challengeKey(deps.config.authHmacKey), challenge, "staff_signin", now));
  await invalidAsStaff(() => spendChallenge(deps.kv, challenge, now));

  const key = await deps.repo.findStaffKeyForSignIn(input.response.id);
  // An unknown or revoked key, and an account that is deleted or no longer staff, are one answer. In development, where
  // the console's relying party ID is the app's, a personal passkey the browser offers here is refused by this lookup alone.
  if (!key || key.revokedAt !== null || key.deletedAt !== null || key.role === "user") throw keyInvalid();
  // A key enrolled for the console at another address (a move that kept the relying party ID) is one more of the same.
  if (!enrolledHere(deps, key)) throw keyInvalid();
  const userHandle = input.response.response.userHandle;
  if (userHandle === undefined || key.webauthnUserId === null || !Buffer.from(userHandle, "base64url").equals(key.webauthnUserId)) throw keyInvalid();

  const verified = await invalidAsStaff(() =>
    verifyAuthentication({
      response: input.response,
      expectedChallenge: challenge,
      // The key's own, which enrolledHere found equal to the console's: audit-verify judges by the same values.
      origins: [key.origin],
      rpId: key.rpId,
      credential: { id: key.credentialId, publicKey: key.publicKey, transports: key.transports },
    }),
  );
  // After the signature only, so each refusal is a claim the key itself signed. WebAuthn L3 asks a relying party that uses
  // BE in its policy to check it on every assertion, and BS as well, since a key can be synced after it was registered.
  if (!verified.userVerified) throw new AuthError("staff_key_not_user_verified", 403);
  if (verified.backupEligible || verified.backedUp) throw new AuthError("staff_key_not_device_bound", 403);
  await enforceLimit(deps.kv, `staff-signin:key:${key.id}`, STAFF_SIGNIN_PER_KEY_PER_HOUR, HOUR);

  const browser = deviceLabel(ctx.userAgent, "web");
  const role = key.role as StaffRole;
  const opened = await openStaffSession(deps, { userId: key.userId, keyId: key.id, role, newCounter: verified.newCounter, browser }, ctx);
  // Null when the key's counter did not move forward (or another revocation reached the key first): it is revoked now.
  if (!opened) return revokeForCounterRegression(deps, key, ctx, "sign_in");
  const { token, session } = opened;
  // After the commit, and best effort as every notice is: a failed mail never undoes a sign-in.
  await notifyAccount(deps, key.email, "staff_session_started", { name: key.name, browser, time: noticeTime(session.createdAt) });
  return { token, me: await staffMe(deps, session) };
}
```

### Replace `apps/api/src/auth/staff/step-up.ts` (whole file)

```ts
import {
  AuthenticationResponseJSON,
  STAFF_STEP_UP_ACTIONS,
  stepUpActionHash,
  type StaffStepUpAction,
  type StaffStepUpOptionsRequest,
  type StaffStoredAssertion,
} from "@korbat/contracts";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import type { AppEnv } from "../../env";
import { errorBody } from "../../lib/errors";
import { validate } from "../../lib/validate";
import { AuthError, type AuthDeps, type StaffRequestContext } from "../context";
import { challengeKey, issueStepUpChallenge, readStepUpChallenge, spendChallenge } from "../passkeys/challenge";
import { authenticationOptions, readResponseChallenge, verifyAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "../passkeys/webauthn";
import { consoleOf, enrolledHere } from "./enroll";
import { revokeForCounterRegression } from "./revoke";
import type { ActiveStaffSession } from "./sessions";

/**
 * The staff step-up (3a design, section 7, Step-up): a route that changes something asks for a fresh assertion from the
 * session's own staff key, made over a challenge bound to the session's handle and to the action's hash, so it confirms
 * that one action, with those params, in that session, once. The routes live in the staff module; the credential work is
 * here, and every refusal the codec or the wrapper raises is answered staff_step_up_invalid, never a passkey_* code.
 */

/** An action a step-up confirms, as the route will execute it: one of the contracts' step-up actions, its target and params. */
export interface StaffStepUpRequest {
  action: StaffStepUpAction;
  target: { type: string; id: string };
  params: Record<string, unknown>;
}

/**
 * What a verified step-up hands the route that executes the action: the action as confirmed, its hash, the key that
 * signed, and the assertion's three members, which the action's audit row stores for audit-verify.
 */
export interface StaffStepUpConfirmed extends StaffStepUpRequest {
  actionHash: string;
  keyId: string;
  assertion: StaffStoredAssertion;
  /**
   * The challenge's expiry. audit-verify refuses a row stamped at or after it, so the action's transaction gives up rather
   * than write its row later than that by the database's clock.
   */
  expiresAt: Date;
}

/** Every refusal of a confirmation before or at its signature, a confirmation made for anything else included. */
const stepUpInvalid = () => new AuthError("staff_step_up_invalid", 403);

/** Runs one step of the codec or the wrapper, answering its passkey_* refusals with staff_step_up_invalid; challenge_expired stays, and the console asks again. */
async function invalidAsStepUp<T>(step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    if (err instanceof AuthError && (err.code === "passkey_invalid" || err.code === "passkey_unsupported")) throw stepUpInvalid();
    throw err;
  }
}

/**
 * Options for confirming one action: a step-up challenge bound to the session's handle and the hash of exactly the
 * `{ action, target, params }` the console sent, user verification required, the console's relying party, and an allow
 * list holding only the session's key. The console checks the binding before it asks for the key. Handing them out
 * stores nothing.
 */
export async function stepUpOptions(deps: AuthDeps, session: ActiveStaffSession, request: StaffStepUpOptionsRequest): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  const staffConsole = consoleOf(deps);
  const key = await deps.repo.findStaffKeyCredential(session.keyId);
  // requireStaff read the session with its key live; a key revoked since then ends the session as requireStaff would, and
  // requireStaff clears both cookies on this answer as on its own.
  if (!key || key.revokedAt !== null) throw new AuthError("staff_session_required", 401);
  // A session opened before the console moved (its relying party ID kept) holds a key that confirms nothing here: no
  // options, so the key is never asked for a confirmation audit-verify would refuse for good.
  if (!enrolledHere(deps, key)) throw stepUpInvalid();
  const actionHash = await stepUpActionHash(request);
  const challenge = issueStepUpChallenge(challengeKey(deps.config.authHmacKey), deps.now(), session.handle, actionHash);
  const options = await authenticationOptions({
    rpId: staffConsole.rpId,
    allow: [{ id: key.credentialId, transports: key.transports }],
    challenge,
    userVerification: "required",
  });
  return { options };
}

/**
 * Verifies a confirmation of `request` in `session`. The action's hash is recomputed from what the route is about to do,
 * and the challenge read from the assertion is checked against the session's handle and that hash, then spent, before
 * anything else runs. The assertion must come from the session's own key, enrolled for the console as it is configured
 * now, and is verified against the origin and relying party ID recorded on the key, which are then CONSOLE_ORIGIN's and
 * CONSOLE_RP_ID's, as audit-verify judges it. A challenge the codec refuses (forged, of another purpose, bound to another
 * session, action, target or params, or spent), an assertion from another key, a key enrolled at another address and one
 * the library refuses are all staff_step_up_invalid.
 * Only after the signature are the flags read, each refusal with its own code, as at sign-in; then 1c's counter rule, where
 * a regression revokes the key and every staff session it opened.
 */
export async function verifyStepUp(
  deps: AuthDeps,
  session: ActiveStaffSession,
  request: StaffStepUpRequest,
  stepUp: AuthenticationResponseJSON,
  ctx: StaffRequestContext,
): Promise<StaffStepUpConfirmed> {
  const now = deps.now();
  const actionHash = await stepUpActionHash(request);
  const challenge = await invalidAsStepUp(() => readResponseChallenge(stepUp));
  // Read with a minute of its life to spare, so the audit row written after the steps below is normally well before its
  // expiry; the action's transaction makes sure of it by the database's clock.
  const expiresAt = await invalidAsStepUp(() => readStepUpChallenge(challengeKey(deps.config.authHmacKey), challenge, now, session.handle, actionHash));
  await invalidAsStepUp(() => spendChallenge(deps.kv, challenge, now));

  const key = await deps.repo.findStaffKeyCredential(session.keyId);
  // Only the session's own key confirms, as the options' allow list said; a key revoked since requireStaff read the
  // session confirms nothing either.
  if (!key || key.revokedAt !== null || key.userId !== session.userId || stepUp.id !== key.credentialId) throw stepUpInvalid();
  if (!enrolledHere(deps, key)) throw stepUpInvalid();
  const verified = await invalidAsStepUp(() =>
    verifyAuthentication({
      response: stepUp,
      expectedChallenge: challenge,
      // The key's own, which enrolledHere found equal to the console's: audit-verify judges by the same values.
      origins: [key.origin],
      rpId: key.rpId,
      credential: { id: key.credentialId, publicKey: key.publicKey, transports: key.transports },
    }),
  );
  // After the signature only, so each refusal is a claim the key itself signed (3a design, section 2).
  if (!verified.userVerified) throw new AuthError("staff_key_not_user_verified", 403);
  if (verified.backupEligible || verified.backedUp) throw new AuthError("staff_key_not_device_bound", 403);
  // False when the key's counter did not move forward (or another revocation reached the key first): it is revoked now.
  if (!(await deps.repo.recordStaffKeyUse({ keyId: key.id, userId: key.userId, newCounter: verified.newCounter, now }))) {
    return revokeForCounterRegression(deps, key, ctx, "step_up");
  }
  return {
    action: request.action,
    target: { type: request.target.type, id: request.target.id },
    params: request.params,
    actionHash,
    keyId: key.id,
    // Exactly as the browser sent them: audit-verify checks the signature over these bytes.
    assertion: { authenticatorData: stepUp.response.authenticatorData, clientDataJSON: stepUp.response.clientDataJSON, signature: stepUp.response.signature },
    expiresAt,
  };
}

/**
 * Stands before every staff route that changes something, behind requireStaff (3a design, section 7, Step-up). The route
 * takes its own body with the assertion added as `stepUp`; the rest of the body is the action's params, validated by the
 * action's own strict schema, and `target` reads the action's target from the request itself (for DELETE
 * /api/staff/sessions/:handle, the path's handle). The action's hash is recomputed from exactly that, so the route executes
 * only what the key confirmed. Without `stepUp` the answer is staff_step_up_required; a malformed body is invalid_request,
 * as the shared validator answers it. The confirmed step-up is left in `staffStepUp` for the route to record.
 */
export function requireStaffStepUp(deps: AuthDeps, action: StaffStepUpAction, target: (c: Context<AppEnv>) => string | undefined) {
  const spec = STAFF_STEP_UP_ACTIONS[action];
  const body = spec.params.extend({ stepUp: AuthenticationResponseJSON.optional() });
  const readBody = validate("json", body);
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = c.get("staffSession");
    if (!session) throw new Error("requireStaffStepUp runs behind requireStaff");
    const targetId = spec.targetId.safeParse(target(c));
    if (!targetId.success) {
      return c.json(errorBody("invalid_request", "Request validation failed", c.get("requestId"), z.treeifyError(targetId.error)), 400);
    }
    // The shared validator answers a body its schema refuses; on success it leaves the parsed body on the request.
    const refused = await readBody(c as Parameters<typeof readBody>[0], async () => {});
    if (refused) return refused;
    const { stepUp, ...params } = body.parse((c.req as unknown as { valid(target: "json"): unknown }).valid("json"));
    if (stepUp === undefined) throw new AuthError("staff_step_up_required", 403);
    const ctx: StaffRequestContext = { ipHash: c.get("clientIpHash") ?? "direct", userAgent: c.req.header("user-agent"), requestId: c.get("requestId") };
    c.set("staffStepUp", await verifyStepUp(deps, session, { action, target: { type: spec.targetType, id: targetId.data }, params }, stepUp, ctx));
    await next();
  });
}

/**
 * DELETE /api/staff/sessions/:handle, once its step-up verified: revokes one of the person's own live staff sessions with
 * its staff_session_revoked event and its audit row, which carries the confirmation, in one transaction. False when the
 * handle names no live session of the person's, which writes nothing. When the confirming key or the account no longer
 * opens anything by then, the session that confirmed has ended: staff_session_required, and nothing is revoked. When the
 * row could not join the chain before the challenge's expiry (a lock held too long), nothing is revoked either:
 * challenge_expired, and the console asks again. No mail: the person did it themselves, with their key.
 */
export async function revokeStaffSession(deps: AuthDeps, session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: StaffRequestContext): Promise<boolean> {
  // A confirmation of anything else never revokes a session: that would be a wiring fault, not a refusal.
  if (confirmed.action !== "staff_session_revoked" || confirmed.target.type !== "staff_session" || confirmed.keyId !== session.keyId) {
    throw new Error("a staff session's revocation needs a step-up that confirmed it");
  }
  const outcome = await deps.repo.revokeConfirmedStaffSession({
    userId: session.userId,
    staffSession: session.handle,
    keyId: confirmed.keyId,
    handle: confirmed.target.id,
    actionHash: confirmed.actionHash,
    params: confirmed.params,
    stepUp: confirmed.assertion,
    expiresAt: confirmed.expiresAt,
    now: deps.now(),
    ipHash: ctx.ipHash,
    requestId: ctx.requestId,
  });
  // requireStaff clears both cookies on this answer, as on its own.
  if (outcome === "ended") throw new AuthError("staff_session_required", 401);
  if (outcome === "late") throw new AuthError("challenge_expired", 400);
  return outcome === "revoked";
}
```

### Replace `apps/api/src/cli/grant-role.ts` (whole file)

```ts
/**
 * Changes an account's role. Run on the server only; there is no API endpoint for this.
 *
 *   docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>
 *
 * Every session and staff session of the account is revoked and every unused staff enrolment link deleted; a change to
 * user also revokes every staff key, and the owner is mailed their names (3a design, section 7). The change is written to
 * public.audit_log in the same transaction. A mail that fails is printed as a warning and undoes nothing.
 */
import { pathToFileURL } from "node:url";
import Redis from "ioredis";
import { Email, Role } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { createAuthRepo, createSessions, grantRole, redisKv, type KeyValueStore, type RoleGranted, type UserRole } from "../auth";
import { loadConfig } from "../config";
import type { Mailer } from "../mail/mailer";
import { LOCK_TIMEOUT_ADVICE, isLockTimeout } from "./lock-timeout";
import { commandLineMailer } from "./mail";

/** Audit-log actor for changes made from the server console rather than by a signed-in person; the auth module writes the row. */
export { SYSTEM_ACTOR_ID } from "../auth";
export const GRANT_ROLE_USAGE = "usage: node dist/grant-role.js <email> <user|moderator|admin>";

export function parseGrantRoleArgs(args: readonly string[]): { email: string; role: UserRole } {
  if (args.length !== 2) throw new Error(GRANT_ROLE_USAGE);
  const email = Email.safeParse(args[0]);
  if (!email.success) throw new Error(`not an email address: ${args[0]}\n${GRANT_ROLE_USAGE}`);
  const role = Role.safeParse(args[1]);
  if (!role.success) throw new Error(`unknown role: ${args[1]}\n${GRANT_ROLE_USAGE}`);
  return { email: email.data, role: role.data };
}

/**
 * The role change and its audit rows in one transaction on the auth role, then the tombstones and the mail; grant-role
 * opens no pool on the API's role.
 */
export async function runGrantRole(deps: { authDb: Db; kv: KeyValueStore; mailer: Mailer }, email: string, role: UserRole) {
  const repo = createAuthRepo(deps.authDb);
  const sessions = createSessions({ repo, kv: deps.kv });
  try {
    return await grantRole({ repo, sessions, mailer: deps.mailer }, email, role);
  } catch (err) {
    if (isLockTimeout(err)) throw new Error(`grant-role changed nothing: ${LOCK_TIMEOUT_ADVICE}`, { cause: err });
    throw err;
  }
}

/**
 * What the command prints once the change has committed: the summary always, on stdout, and a warning on stderr for each
 * step after the commit that failed. None of them undoes the change, so the command exits 0 whatever they say.
 */
export function grantRoleReport(granted: RoleGranted, role: UserRole): { out: string[]; warnings: string[] } {
  const out = [
    `user ${granted.userId}: role ${granted.previousRole} -> ${role}; every session revoked; ` +
      `${granted.staffSessionsRevoked} staff sessions and ${granted.staffKeysRevoked} staff keys revoked, ${granted.enrollmentsDeleted} unused enrolment links deleted`,
  ];
  const warnings: string[] = [];
  if (granted.tombstoneError !== null) {
    warnings.push(
      `warning: the revoked app sessions could not be marked in Valkey (${granted.tombstoneError}); they are revoked in the database, ` +
        "a cached copy may still answer for up to a minute; the change stands",
    );
  }
  if (granted.mailError !== null) warnings.push(`warning: the staff_keys_revoked mail to the account could not be sent (${granted.mailError}); the change stands`);
  return { out, warnings };
}

async function main(): Promise<number> {
  let parsed: { email: string; role: UserRole };
  try {
    parsed = parseGrantRoleArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
  const config = loadConfig();
  const authDb = createDb(config.DATABASE_URL_AUTH, { max: 1 });
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
  try {
    // The same mailer as the staff command line's, built as the API builds its own.
    const granted = await runGrantRole({ authDb, kv: redisKv(redis), mailer: commandLineMailer(process.env) }, parsed.email, parsed.role);
    const report = grantRoleReport(granted, parsed.role);
    for (const line of report.out) console.log(line);
    for (const line of report.warnings) console.error(line);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await Promise.allSettled([closeDb(authDb), redis.quit()]);
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
```

### Replace `apps/api/src/cli/staff.ts` (whole file)

```ts
/**
 * The staff command line (3a design, section 7). Run on the server only. enroll runs in the migrate service, as the
 * migrator, the one application role the running API never holds; the others run like grant-role:
 *
 *   docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js keys [<email>]
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js revoke <email> <key id>|all
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-head
 *   docker compose -f infra/compose.yml run --rm api node dist/staff.js audit-verify [<chain_seq>:<hash> ...]
 *
 * enroll prints a one-time link that registers one staff key for a live staff account with a handle; the database lets
 * only the migrator issue one. keys lists an account's staff keys, or every staff account with its keys, for the
 * runbook's comparison with the operator's own list. revoke revokes one key and every staff session it opened, or with
 * `all` every key and staff session of the account and its unused enrolment links, and mails the owner; it is the only way
 * to revoke a key by hand, since no console route does.
 *
 * audit-head prints the audit log's newest place and hash, which the keeper holds off the server. audit-verify recomputes
 * the whole chain in its own code (the staff module's chain.ts), never asking the database for a text or a hash, since
 * whoever owns the database can replace its functions, and checks it against the places kept before: a rewrite that
 * recomputed every later hash still fails against a place kept before it. It also checks every step-up a row stores
 * against the public key, owner, origin and relying party ID of the key it names, so a confirmed action is in the record
 * only with an assertion its actor's key made for exactly that action. Neither needs a server secret or the console's
 * configuration, so both run the same with the console off or moved: each reads only the database URLs it connects with
 * (staffDatabaseUrls), never the API's whole configuration.
 */
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { Email, STAFF_STEP_UP_ACTIONS, STAFF_STEP_UP_CHALLENGE, StaffStoredAssertion, stepUpActionHash, stepUpBindingText } from "@korbat/contracts";
import { auditHead, auditLog, authEvents, closeDb, createDb, profiles, staffEnrollments, staffKeys, users, type Db, type DbTx } from "@korbat/db";
import { SYSTEM_ACTOR_ID, createAuthRepo, revokeStaffKeys, verifyRecordedAssertion, type StaffKeysRevokedReport } from "../auth";
import { consoleHostOf, consoleOriginSetting, consoleRpIdSetting, databaseUrl, mailFrom, smtpUrl } from "../config";
import { CHAIN_ZERO_HASH, canonicalText, chainHash } from "../staff";
import { LOCK_TIMEOUT_ADVICE, isLockTimeout } from "./lock-timeout";
import { mailerFor, type CommandLineMailSettings } from "./mail";

export const STAFF_USAGE = [
  "usage: node dist/staff.js <command>",
  "  enroll <email>                         print a one-time link, valid 30 minutes, that registers one staff key for the account;",
  "                                         run it in the migrate service: docker compose -f infra/compose.yml run --rm migrate node dist/staff.js enroll <email>",
  "  keys [<email>]                         list the account's staff keys, or every staff account with its role, address, handle and keys",
  "  audit-head                             print the audit log's newest place, its hash and its time, to keep off the server",
  "  audit-verify [<chain_seq>:<hash> ...]  recompute the audit chain and check it against places kept before",
  "  revoke <email> <key id>                revoke that staff key and every staff session it opened, and mail its owner",
  "  revoke <email> all                     revoke every staff key and staff session of the account, delete its unused",
  "                                         enrolment links, and mail its owner",
].join("\n");

/** A place in the chain and the hash it had when someone kept it, as audit-head printed it. */
export interface KeptPlace {
  seq: number;
  hash: string;
}

export type StaffCommand =
  | { command: "enroll"; email: string }
  | { command: "keys"; email: string | null }
  | { command: "audit-head" }
  | { command: "audit-verify"; kept: KeptPlace[] }
  | { command: "revoke"; email: string; key: string | "all" };

/** A place as the keeper copies it: at most 15 digits, so it is always a safe integer, and a lower-case hex sha256. */
const KEPT_PLACE = /^([1-9][0-9]{0,14}):([0-9a-f]{64})$/;
/** A staff key's id as `keys` prints it: a uuid, read in any case and kept in PostgreSQL's lower-case form. */
const KEY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An address as the account was registered with it: trimmed and lower-cased, as the contracts read it. */
function emailArg(arg: string): string {
  const email = Email.safeParse(arg);
  if (!email.success) throw new Error(`not an email address: ${arg}\n${STAFF_USAGE}`);
  return email.data;
}

export function parseStaffArgs(args: readonly string[]): StaffCommand {
  const [command, ...rest] = args;
  switch (command) {
    case "enroll":
      if (rest.length !== 1) throw new Error(STAFF_USAGE);
      return { command, email: emailArg(rest[0]!) };
    case "keys":
      if (rest.length > 1) throw new Error(STAFF_USAGE);
      return { command, email: rest.length === 1 ? emailArg(rest[0]!) : null };
    case "audit-head":
      if (rest.length > 0) throw new Error(STAFF_USAGE);
      return { command };
    case "revoke": {
      if (rest.length !== 2) throw new Error(STAFF_USAGE);
      const email = emailArg(rest[0]!);
      // Exactly "all"; anything else must be a key's id, so a typo never revokes every key.
      if (rest[1] === "all") return { command, email, key: "all" };
      const key = rest[1]!.toLowerCase();
      if (!KEY_ID.test(key)) throw new Error(`not a key id or all: ${rest[1]} (staff.js keys prints each key's id)\n${STAFF_USAGE}`);
      return { command, email, key };
    }
    case "audit-verify":
      return {
        command,
        kept: rest.map((arg) => {
          const match = KEPT_PLACE.exec(arg);
          if (!match) throw new Error(`not a kept place: ${arg} (a kept place is <chain_seq>:<hash>, as audit-head prints it)\n${STAFF_USAGE}`);
          return { seq: Number(match[1]), hash: match[2]! };
        }),
      };
    case undefined:
      throw new Error(STAFF_USAGE);
    default:
      throw new Error(`unknown command: ${command}\n${STAFF_USAGE}`);
  }
}

// ---------------------------------------------------------------- the environment

/**
 * What each command reads of the environment, after its arguments are known, and nothing more. The API's configuration
 * (loadConfig) would also require its secrets, Valkey, the mail settings and APP_ORIGIN, and would refuse a CONSOLE_ORIGIN
 * its rules reject, none of which these commands use. audit-head reads the record on the API's role; audit-verify also
 * reads the staff keys on the auth role's.
 */
const AUDIT_HEAD_ENV = z.object({ DATABASE_URL_API: databaseUrl });
const AUDIT_VERIFY_ENV = AUDIT_HEAD_ENV.extend({ DATABASE_URL_AUTH: databaseUrl });

function readEnv<T extends z.ZodType>(schema: T, env: Record<string, string | undefined>, command: string): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error(`Invalid environment for ${command}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/**
 * The database URLs a command connects with: the API role's, and the auth role's for audit-verify and keys, which read the
 * staff keys there. enroll connects as the migrator alone and reads its settings with enrollSettings.
 */
export function staffDatabaseUrls(command: Exclude<StaffCommand, { command: "enroll" | "revoke" }>, env: Record<string, string | undefined>): { api: string; auth: string | null } {
  if (command.command === "audit-verify" || command.command === "keys") {
    const urls = readEnv(AUDIT_VERIFY_ENV, env, command.command);
    return { api: urls.DATABASE_URL_API, auth: urls.DATABASE_URL_AUTH };
  }
  return { api: readEnv(AUDIT_HEAD_ENV, env, command.command).DATABASE_URL_API, auth: null };
}

/**
 * What enroll reads: the migrator's URL, which only the migrate service holds, and the console's origin and relying party
 * ID, which Compose gives that service, each by the API's own rule for it. The relying party ID defaults to the console's
 * hostname, as the API's does. Nothing else of the API's configuration is read: the migrate service holds none of it.
 */
const ENROLL_ENV = z.object({ DATABASE_URL_MIGRATE: databaseUrl, CONSOLE_ORIGIN: consoleOriginSetting, CONSOLE_RP_ID: consoleRpIdSetting });

export interface EnrollSettings {
  migrate: string;
  consoleOrigin: string;
  consoleRpId: string;
}

/** enroll's settings, refusing while the console is off: a link to a console that does not run would enrol nothing. */
export function enrollSettings(env: Record<string, string | undefined>): EnrollSettings {
  // Blank counts as unset, as Compose passes an empty line of infra/.env.
  if (!env.CONSOLE_ORIGIN?.trim()) {
    throw new Error(
      "CONSOLE_ORIGIN is not set: the staff console is off, so no enrolment link can be issued. " +
        "Set API_CONSOLE_ORIGIN in infra/.env to the console's address (the migrate service reads it as CONSOLE_ORIGIN) and run the command again.",
    );
  }
  const settings = readEnv(ENROLL_ENV, env, "enroll");
  const consoleOrigin = settings.CONSOLE_ORIGIN!;
  return { migrate: settings.DATABASE_URL_MIGRATE, consoleOrigin, consoleRpId: settings.CONSOLE_RP_ID ?? consoleHostOf(consoleOrigin) };
}

/**
 * What revoke reads: the auth role's URL, on which it revokes, and the mail settings, with which it tells the key's owner,
 * each by the API's own rule for it. The API role's URL and the API's secrets are not read: revoke needs neither.
 */
const REVOKE_ENV = z.object({ DATABASE_URL_AUTH: databaseUrl, SMTP_URL: smtpUrl, MAIL_FROM: mailFrom, NODE_ENV: z.string().optional() });

export interface RevokeSettings {
  auth: string;
  mail: CommandLineMailSettings;
}

/** revoke's settings; production refuses a plain relay that does not upgrade with STARTTLS, as the API does. */
export function revokeSettings(env: Record<string, string | undefined>): RevokeSettings {
  const settings = readEnv(REVOKE_ENV, env, "revoke");
  return { auth: settings.DATABASE_URL_AUTH, mail: { smtpUrl: settings.SMTP_URL, mailFrom: settings.MAIL_FROM, requireTls: settings.NODE_ENV === "production" } };
}

// ---------------------------------------------------------------- reading the record

/** What the record is read through: the command line's own connection, or a transaction a test hands in. */
type Reader = Pick<Db, "select" | "execute">;

/** How many rows audit-verify reads at a time. */
export const AUDIT_VERIFY_PAGE_SIZE = 1000;
const PAGE_SIZE = AUDIT_VERIFY_PAGE_SIZE;

/**
 * Sets the transaction up to read the record as the canonical text needs it. Times come as ISO text in UTC, which is what
 * the rows' Date values are parsed from (a session in 'SQL, DMY' would print another form), and a lock is waited on for
 * at most 10 seconds, as every staff command waits.
 */
async function readingSettings(q: Reader): Promise<void> {
  await q.execute(sql`set local datestyle = 'ISO'`);
  await q.execute(sql`set local timezone = 'UTC'`);
  await q.execute(sql`set local lock_timeout = '10s'`);
}

/**
 * The next page of rows after the row `after` (from the lowest place when null) up to place `upto` (to the end when null),
 * in chain order, and by id among rows that share a place. Paging on the place and the id, never the place alone, reads a
 * second row at the place that ends a page, which the walk then refuses; on the place alone the next page would start
 * after that place and never read it. The jsonb columns come as PostgreSQL prints them, which the canonical text embeds
 * as it is.
 */
function chainRows(q: Reader, after: { seq: number; id: number } | null, upto: number | null) {
  return q
    .select({
      id: auditLog.id,
      chainVersion: auditLog.chainVersion,
      chainSeq: auditLog.chainSeq,
      createdAt: auditLog.createdAt,
      actorId: auditLog.actorId,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      requestId: auditLog.requestId,
      staffSession: auditLog.staffSession,
      keyId: auditLog.keyId,
      actionHash: auditLog.actionHash,
      stepUpText: sql<string | null>`${auditLog.stepUp}::text`,
      metadataText: sql<string>`${auditLog.metadata}::text`,
      prevHash: auditLog.prevHash,
      hash: auditLog.hash,
    })
    .from(auditLog)
    .where(
      and(
        after === null ? undefined : sql`(${auditLog.chainSeq}, ${auditLog.id}) > (${after.seq}::bigint, ${after.id}::bigint)`,
        upto === null ? undefined : lte(auditLog.chainSeq, upto),
      ),
    )
    .orderBy(asc(auditLog.chainSeq), asc(auditLog.id))
    .limit(PAGE_SIZE);
}

// ---------------------------------------------------------------- audit-verify

/** One thing audit-verify found wrong: the place it is at, or null for the head or a staff key. */
export interface AuditProblem {
  place: number | null;
  message: string;
}

export interface AuditReport {
  ok: boolean;
  /** The rows read: every row up to the head's place, a second row at a place included; a row with no place is counted apart. */
  rows: number;
  /** The head as audit_head held it, or null when the row is missing. */
  head: KeptPlace | null;
  keptChecked: number;
  /** How many rows follow the newest kept place, which no kept place anchors yet; every row when none was given. */
  unanchored: number;
  keysChecked: number;
  /** Keys whose staff_key_added row was written after the head this run read: the next run checks them. */
  keysLeftToNextRun: number;
  /** The first problems, in chain order, then the head's, the kept places' and the keys'. */
  problems: AuditProblem[];
  problemCount: number;
}

/** How many problems a report keeps: enough to name the first rows at fault. */
const PROBLEMS_KEPT = 100;

// ---------------------------------------------------------------- step-ups

/**
 * A staff key as audit-verify checks a step-up against it (3a design, section 7, Command line): its owner, its credential
 * and public key, and the origin and relying party ID recorded on it at enrolment, never the console's configuration now.
 */
interface RecordedKey {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  origin: string;
  rpId: string;
}

/** A row as the step-up checks read it: the chain's columns, with the metadata and the step-up as PostgreSQL printed them. */
type StepUpRow = Awaited<ReturnType<typeof chainRows>>[number];

// The authenticator data's flags byte follows the 32-byte hash of the relying party ID: UP and UV (WebAuthn L3, section 6.1).
const AUTH_DATA_FLAGS_AT = 32;
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

const sha256 = (text: string) => createHash("sha256").update(text).digest();

/** The members of a JSON object, or null for anything else. */
function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The client data a stored assertion carries, as JSON, or null when it cannot be read. */
function clientDataOf(assertion: StaffStoredAssertion): { type: unknown; origin: unknown; challenge: unknown } | null {
  try {
    const data = objectOf(JSON.parse(Buffer.from(assertion.clientDataJSON, "base64url").toString("utf8")));
    return data ? { type: data.type, origin: data.origin, challenge: data.challenge } : null;
  } catch {
    return null;
  }
}

/** A step-up challenge's binding and expiry, read at the contracts' offsets without the sealing key, or null for anything else. */
function stepUpChallengeOf(challenge: unknown): { binding: Buffer; expiresAt: number } | null {
  const L = STAFF_STEP_UP_CHALLENGE;
  if (typeof challenge !== "string" || challenge.length !== L.encodedLength) return null;
  const bytes = Buffer.from(challenge, "base64url");
  // Only the canonical encoding, as the API's codec reads it.
  if (bytes.length !== L.bytes || bytes.toString("base64url") !== challenge) return null;
  if (bytes[L.versionAt] !== L.version || bytes[L.purposeAt] !== L.purpose) return null;
  return { binding: bytes.subarray(L.bindingAt, L.bindingAt + L.bindingBytes), expiresAt: Number(bytes.readBigUInt64BE(L.expiryAt)) };
}

/**
 * One row's step-up (3a design, section 7, Command line), checked in audit-verify's own code with no server secret: a row
 * of a step-up action must carry one, whatever its actor; and a step-up must hold an assertion that the key the row names,
 * a key of the row's actor, made over a step-up challenge bound to the row's session and to the hash of the row's action,
 * target and `metadata.params`, unexpired when the row joined the chain, as a webauthn.get from the origin recorded on the
 * key, naming the relying party ID recorded on it, with user presence and verification. Answers the first check that fails,
 * or null, and the challenge the client data names, which no other row may carry.
 */
async function checkStepUp(row: StepUpRow, keys: ReadonlyMap<string, RecordedKey>): Promise<{ problem: string | null; challenge: string | null }> {
  const fail = (problem: string, challenge: string | null = null) => ({ problem, challenge });
  if (row.stepUpText === null) {
    return Object.hasOwn(STAFF_STEP_UP_ACTIONS, row.action) ? fail(`its action, ${row.action}, needs a step-up, and it carries none`) : { problem: null, challenge: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.stepUpText);
  } catch {
    parsed = null;
  }
  const stored = StaffStoredAssertion.safeParse(parsed);
  if (!stored.success) return fail("its step-up is not a stored assertion");
  const assertion = stored.data;
  const clientData = clientDataOf(assertion);
  const challenge = typeof clientData?.challenge === "string" ? clientData.challenge : null;

  if (row.staffSession === null) return fail("its step-up names no staff session", challenge);
  if (row.keyId === null) return fail("its step-up names no staff key", challenge);
  // The action's hash from the row itself, never from its action_hash column, which the next check compares with it. The
  // metadata is PostgreSQL's print of a jsonb value, so it always parses.
  const params = objectOf(objectOf(JSON.parse(row.metadataText) as unknown)?.params);
  if (row.targetType === null || row.targetId === null || params === null) {
    return fail("its step-up's action cannot be recomputed: it needs a target and metadata.params", challenge);
  }
  let actionHash: string;
  try {
    actionHash = await stepUpActionHash({ action: row.action, target: { type: row.targetType, id: row.targetId }, params });
  } catch {
    return fail("its step-up's action cannot be recomputed: its params are not JSON", challenge);
  }
  if (row.actionHash !== actionHash) return fail("its step-up's action hash is not the hash of its action, target and params", challenge);
  const key = keys.get(row.keyId);
  if (!key) return fail(`its step-up names key ${row.keyId}, which is not a staff key`, challenge);
  if (key.userId !== row.actorId) return fail(`its step-up's key ${key.id} belongs to another account than its actor`, challenge);
  if (clientData === null || clientData.type !== "webauthn.get" || clientData.origin !== key.origin) {
    return fail("its step-up's client data is not a webauthn.get from the origin recorded on its key", challenge);
  }
  const issued = stepUpChallengeOf(challenge);
  if (!issued) return fail("its step-up's challenge is not a step-up challenge", challenge);
  if (!issued.binding.equals(sha256(stepUpBindingText(row.staffSession, actionHash)))) {
    return fail("its step-up's challenge was not issued for this action in this session", challenge);
  }
  if (row.createdAt.getTime() >= issued.expiresAt) return fail("its step-up's challenge had expired when the row was written", challenge);
  const authData = Buffer.from(assertion.authenticatorData, "base64url");
  if (authData.length <= AUTH_DATA_FLAGS_AT || !authData.subarray(0, AUTH_DATA_FLAGS_AT).equals(sha256(key.rpId))) {
    return fail("its step-up's authenticator data does not name the relying party ID recorded on its key", challenge);
  }
  const flags = authData[AUTH_DATA_FLAGS_AT]!;
  if ((flags & FLAG_UP) === 0 || (flags & FLAG_UV) === 0) return fail("its step-up's authenticator data does not report user presence and verification", challenge);
  // The library checks all of the above again, and the signature over the authenticator data and the client data's hash.
  const verified = await verifyRecordedAssertion({ assertion, credential: { id: key.credentialId, publicKey: key.publicKey }, origin: key.origin, rpId: key.rpId });
  if (!verified) return fail(`its step-up's signature does not verify with the public key of key ${key.id}`, challenge);
  return { problem: null, challenge };
}

/** What one snapshot of the record showed, before the keys missing from it are looked up again. */
interface Walk {
  head: KeptPlace | null;
  rows: number;
  newest: KeptPlace | null;
  keptChecked: number;
  unanchored: number;
  keys: string[];
  /** The places of the staff_key_added rows read, by the key their key_id names. */
  keyRows: Map<string, number[]>;
  problems: AuditProblem[];
  problemCount: number;
}

/**
 * Everything audit-verify checks inside one view of the record: the head, then every row up to the head's place in chain
 * order, a page at a time. Run in a REPEATABLE READ transaction, a row written meanwhile is neither read nor missed. The
 * staff keys are read from `keysFrom` after the head, so each key listed either has its staff_key_added row among the
 * rows read or was added after the head, and every key a row read names is among them, since no key is ever deleted.
 */
async function walkRecord(q: Reader, kept: readonly KeptPlace[], keysFrom: Pick<Db, "select">): Promise<Walk> {
  const problems: AuditProblem[] = [];
  let problemCount = 0;
  const problem = (place: number | null, message: string) => {
    problemCount++;
    if (problems.length < PROBLEMS_KEPT) problems.push({ place, message });
  };

  await readingSettings(q);
  const [headRow] = await q.select({ seq: auditHead.seq, hash: auditHead.hash }).from(auditHead).where(eq(auditHead.id, 1));
  const head = headRow ?? null;
  if (!head) problem(null, "the audit head is missing");
  // What the step-up checks need of each key, and nothing more: never its name, counter or transports.
  const recordedKeys = await keysFrom
    .select({ id: staffKeys.id, userId: staffKeys.userId, credentialId: staffKeys.credentialId, publicKey: staffKeys.publicKey, origin: staffKeys.origin, rpId: staffKeys.rpId })
    .from(staffKeys);
  const keys = recordedKeys.map((key) => key.id);
  const keysById = new Map(recordedKeys.map((key) => [key.id, key]));
  // Every step-up challenge read so far, by the place of the row that carried it: a challenge confirms one row only.
  const challenges = new Map<string, number>();

  const keptAt = new Map<number, string[]>();
  for (const place of kept) keptAt.set(place.seq, [...(keptAt.get(place.seq) ?? []), place.hash]);
  const keptSeen = new Set<number>();
  const keyRows = new Map<string, number[]>();
  let rows = 0;
  let previous: KeptPlace | null = null;
  // Without a head the whole table is read, so the other problems are still named.
  for (let after: { seq: number; id: number } | null = null; ; ) {
    const page = await chainRows(q, after, head ? head.seq : null);
    for (const row of page) {
      rows++;
      const expected = previous ? previous.seq + 1 : 1;
      if (previous && row.chainSeq === previous.seq) {
        problem(row.chainSeq, "another row is already at this place");
      } else if (row.chainSeq < expected) {
        problem(row.chainSeq, "its place is not in the chain, which runs from place 1");
      } else if (row.chainSeq > expected) {
        problem(expected, row.chainSeq - expected === 1 ? `place ${expected} is missing` : `places ${expected} to ${row.chainSeq - 1} are missing`);
      }
      if (row.prevHash !== (previous ? previous.hash : CHAIN_ZERO_HASH)) {
        problem(row.chainSeq, previous ? `its prev_hash is not the hash of place ${previous.seq}` : "its prev_hash is not 64 zeros, as the first row's must be");
      }
      // The row's own hash, over its stored prev_hash: a changed row fails here, and a changed hash fails the next link.
      let text: string | null = null;
      try {
        text = canonicalText(row);
      } catch (err) {
        problem(row.chainSeq, (err as Error).message);
      }
      if (text !== null && chainHash(row.prevHash, text) !== row.hash) problem(row.chainSeq, "its hash does not match its content");
      for (const hash of keptAt.get(row.chainSeq) ?? []) {
        keptSeen.add(row.chainSeq);
        if (hash !== row.hash) problem(row.chainSeq, `the kept place ${row.chainSeq}:${hash} no longer matches: the row there has the hash ${row.hash}`);
      }
      if (row.action === "staff_key_added" && row.keyId !== null) keyRows.set(row.keyId, [...(keyRows.get(row.keyId) ?? []), row.chainSeq]);
      const stepUp = await checkStepUp(row, keysById);
      if (stepUp.problem !== null) problem(row.chainSeq, stepUp.problem);
      if (stepUp.challenge !== null) {
        const first = challenges.get(stepUp.challenge);
        if (first !== undefined) problem(row.chainSeq, `its step-up's challenge was already used at place ${first}`);
        else challenges.set(stepUp.challenge, row.chainSeq);
      }
      previous = { seq: row.chainSeq, hash: row.hash };
    }
    if (page.length < PAGE_SIZE) break;
    const last = page[page.length - 1]!;
    after = { seq: last.chainSeq, id: last.id };
  }

  // Every row of the table, counted in the same view: a row the walk by place cannot reach, one with no place at all,
  // is never read above, so the rows read and the rows beyond the head must make up the whole table, with no place
  // held twice. The counts are compared with the walk's own, never trusted to the database's constraints, which the
  // owner can drop.
  const [counts] = await q
    .select({
      total: sql<string>`count(*)::text`,
      placed: sql<string>`count(${auditLog.chainSeq})::text`,
      places: sql<string>`count(distinct ${auditLog.chainSeq})::text`,
      beyond: head ? sql<string>`(count(*) filter (where ${auditLog.chainSeq} > ${head.seq}::bigint))::text` : sql<string>`'0'`,
    })
    .from(auditLog);
  const total = Number(counts!.total);
  const unplaced = total - Number(counts!.placed);
  const shared = Number(counts!.placed) - Number(counts!.places);
  const beyondCount = Number(counts!.beyond);
  if (unplaced > 0) problem(null, `${plural(unplaced, "row of the audit log has", "rows of the audit log have")} no place in the chain`);
  if (shared > 0) problem(null, `${plural(shared, "row is", "rows are")} at a place another row already holds`);
  if (rows + beyondCount !== total) problem(null, `the audit log holds ${total} rows, but ${rows} were read up to the head and ${beyondCount} lie beyond it`);

  if (head) {
    const [beyond] = await q
      .select({ seq: auditLog.chainSeq })
      .from(auditLog)
      .where(gt(auditLog.chainSeq, head.seq))
      .orderBy(asc(auditLog.chainSeq))
      .limit(1);
    if (beyond) problem(beyond.seq, `rows lie beyond the head's place ${head.seq}, from place ${beyond.seq}`);
    if (!previous) {
      if (head.seq !== 0 || head.hash !== CHAIN_ZERO_HASH) problem(null, `the head names place ${head.seq}, but no row is at or before it`);
    } else if (previous.seq !== head.seq) {
      problem(null, `the head names place ${head.seq}, but the newest row up to it is at place ${previous.seq}`);
    } else if (previous.hash !== head.hash) {
      problem(head.seq, "the head's hash is not the hash of the row at its place");
    }
  }
  for (const place of kept) {
    if (!keptSeen.has(place.seq)) problem(place.seq, `the kept place ${place.seq}:${place.hash} no longer matches: no row is at that place`);
  }
  const newestSeq = previous?.seq ?? 0;
  const newestKept = kept.length > 0 ? Math.max(...kept.map((place) => place.seq)) : 0;
  return {
    head,
    rows,
    newest: previous,
    keptChecked: kept.length,
    unanchored: Math.max(0, newestSeq - newestKept),
    keys,
    keyRows,
    problems,
    problemCount,
  };
}

/**
 * The staff keys' check, outside the snapshot: every staff key has exactly one staff_key_added row, which names it in
 * key_id. A key with none among the rows read is looked up again through `fresh`; one whose row was written after the
 * head is left to the next run, and one with no row at all is a problem.
 */
async function finishReport(walk: Walk, fresh: Pick<Db, "select">): Promise<AuditReport> {
  const problems = [...walk.problems];
  let problemCount = walk.problemCount;
  const problem = (message: string) => {
    problemCount++;
    if (problems.length < PROBLEMS_KEPT) problems.push({ place: null, message });
  };
  const missing: string[] = [];
  for (const key of walk.keys) {
    const places = walk.keyRows.get(key) ?? [];
    if (places.length === 0) missing.push(key);
    else if (places.length > 1) problem(`staff key ${key} has ${places.length} staff_key_added rows (places ${places.join(", ")})`);
  }
  let keysLeftToNextRun = 0;
  if (missing.length > 0) {
    const read = walk.head ? walk.head.seq : (walk.newest?.seq ?? 0);
    const later = await fresh
      .select({ keyId: auditLog.keyId })
      .from(auditLog)
      .where(and(eq(auditLog.action, "staff_key_added"), inArray(auditLog.keyId, missing), gt(auditLog.chainSeq, read)));
    const addedLater = new Set(later.map((row) => row.keyId));
    for (const key of missing) {
      if (addedLater.has(key)) keysLeftToNextRun++;
      else problem(`staff key ${key} has no staff_key_added row`);
    }
  }
  return {
    ok: problemCount === 0,
    rows: walk.rows,
    head: walk.head,
    keptChecked: walk.keptChecked,
    unanchored: walk.unanchored,
    keysChecked: walk.keys.length,
    keysLeftToNextRun,
    problems,
    problemCount,
  };
}

/**
 * audit-verify on the command line's own connections: the record read on the API's role in one REPEATABLE READ READ ONLY
 * transaction, the staff keys on the auth role's.
 */
export async function auditVerify(db: { api: Db; auth: Db }, kept: readonly KeptPlace[]): Promise<AuditReport> {
  const walk = await db.api.transaction((tx) => walkRecord(tx, kept, db.auth), { isolationLevel: "repeatable read", accessMode: "read only" });
  return finishReport(walk, db.api);
}

/**
 * The same check through a transaction the caller holds, so a test can verify rows it wrote, or rewrote as the owner, and
 * then roll back: no later test sees a chain broken on purpose. The staff keys are read through the transaction too,
 * unless its role cannot read them (the API's), when `keysFrom` names the auth role's pool.
 */
export async function checkAuditRecord(tx: DbTx, kept: readonly KeptPlace[], keysFrom: Pick<Db, "select"> = tx): Promise<AuditReport> {
  return finishReport(await walkRecord(tx, kept, keysFrom), tx);
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** How audit-verify reports: what holds, or the first problems; and the rows no kept place anchors yet. */
export function describeReport(report: AuditReport): string[] {
  const lines: string[] = [];
  if (report.ok) {
    lines.push(
      report.rows === 0
        ? "audit-verify: the chain holds: the audit log is empty"
        : `audit-verify: the chain holds: ${plural(report.rows, "row", "rows")}, from place 1 to the head ${report.head!.seq}:${report.head!.hash}`,
    );
  } else {
    lines.push(`audit-verify: FAILED, ${plural(report.problemCount, "problem", "problems")}; the first rows at fault:`);
    const shown = report.problems.slice(0, 20);
    for (const p of shown) lines.push(p.place === null ? `  ${p.message}` : `  place ${p.place}: ${p.message}`);
    if (report.problemCount > shown.length) lines.push(`  and ${report.problemCount - shown.length} more`);
  }
  lines.push(
    report.keptChecked === 0
      ? `no kept place given: ${plural(report.unanchored, "row is", "rows are")} not yet anchored by a kept place`
      :`${plural(report.keptChecked, "kept place", "kept places")} checked; ${plural(report.unanchored, "row", "rows")} after the newest kept place ${report.unanchored === 1 ? "is" : "are"} not yet anchored`,
  );
  lines.push(
    `${plural(report.keysChecked, "staff key", "staff keys")} checked` +
      (report.keysLeftToNextRun > 0 ? `; ${plural(report.keysLeftToNextRun, "key was", "keys were")} added after this run's head and are left to the next run` : ""),
  );
  return lines;
}

// ---------------------------------------------------------------- enroll

/** How long an enrolment link works (3a design, section 2). */
const ENROLMENT_MINUTES = 30;
/** At most this many live staff keys per account; auth.add_staff_key refuses a sixth too. */
const LIVE_KEYS_MAX = 5;

/** What enroll issued, or why it refused. */
export type IssuedEnrolment =
  | { ok: true; token: string; email: string; role: string; expiresAt: Date }
  | { ok: false; problem: string };

/**
 * Issues an enrolment link as the migrator (3a design, section 7), in one transaction that first locks the account's row
 * FOR NO KEY UPDATE, as every writer of staff rows takes it, and waits for it at most 10 seconds. It refuses, writing
 * nothing, unless the account is live, staff and has a handle (the console names staff by their handle) and holds fewer
 * than five live keys. It writes the enrolment with only the token's sha256 and the console's origin and relying party ID,
 * its staff_enrollment_issued event, and last its audit row, which holds the chain's head until the commit. The token is
 * 32 random bytes; it is printed once and kept nowhere.
 */
export async function issueEnrolment(db: Db, email: string, settings: Pick<EnrollSettings, "consoleOrigin" | "consoleRpId">): Promise<IssuedEnrolment> {
  return db.transaction(async (tx): Promise<IssuedEnrolment> => {
    await tx.execute(sql`set local lock_timeout = '10s'`);
    const [account] = await tx
      .select({ id: users.id, email: users.email, role: users.role, onboardedAt: users.onboardedAt })
      .from(users)
      .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
      .limit(1)
      .for("no key update");
    if (!account) return { ok: false, problem: `no live account for ${email}` };
    if (account.role === "user") return { ok: false, problem: `${email} is not staff (its role is user): make it staff with grant-role first` };
    if (account.onboardedAt === null) {
      return { ok: false, problem: `${email} has no handle yet: the console names staff by their handle, so the account chooses one in the app first` };
    }
    const [held] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(staffKeys)
      .where(and(eq(staffKeys.userId, account.id), isNull(staffKeys.revokedAt)));
    if ((held?.count ?? 0) >= LIVE_KEYS_MAX) {
      return { ok: false, problem: `${email} already holds ${LIVE_KEYS_MAX} live staff keys, the most an account may hold: revoke one before enrolling another` };
    }
    const token = randomBytes(32).toString("base64url");
    // The database's clock, which auth.add_staff_key checks the expiry against; the creation time is the same now().
    const [enrolment] = await tx
      .insert(staffEnrollments)
      .values({
        userId: account.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        origin: settings.consoleOrigin,
        rpId: settings.consoleRpId,
        expiresAt: sql`now() + make_interval(mins => ${ENROLMENT_MINUTES}::int)`,
      })
      .returning({ id: staffEnrollments.id, expiresAt: staffEnrollments.expiresAt });
    await tx.insert(authEvents).values({ userId: account.id, type: "staff_enrollment_issued", metadata: { enrollmentId: enrolment!.id, via: "cli" } });
    // As the migrator the row is written directly: auth.append_audit is the auth role's way, and does not take this action.
    await tx.insert(auditLog).values({
      actorId: SYSTEM_ACTOR_ID,
      action: "staff_enrollment_issued",
      targetType: "user",
      targetId: account.id,
      metadata: { enrollmentId: enrolment!.id, via: "cli" },
    });
    return { ok: true, token, email: account.email, role: account.role, expiresAt: enrolment!.expiresAt };
  });
}

/** What enroll prints: the link on a line of its own, so it can be copied whole, and how to hand it over. */
export function describeEnrolment(issued: Extract<IssuedEnrolment, { ok: true }>, consoleOrigin: string): string[] {
  return [
    `Enrolment link for ${issued.email} (${issued.role}), valid for ${ENROLMENT_MINUTES} minutes, until ${issued.expiresAt.toISOString()}, and once:`,
    `${consoleOrigin}/enroll/${issued.token}`,
    "Hand it over by a channel you trust: whoever holds it can register a staff key for this account. The person opens it on the device that holds the key, then signs in once with the new key.",
  ];
}

// ---------------------------------------------------------------- keys

/** One account as keys lists it, with its keys oldest first. */
export interface StaffKeysListing {
  id: string;
  email: string;
  role: string;
  handle: string | null;
  keys: {
    id: string;
    name: string;
    aaguid: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    suspectAt: Date | null;
  }[];
}

/**
 * Runs `read` in a read-only transaction that waits at most 10 seconds for a lock, as every staff command waits: the API's
 * roles may lock any table they can update and hold it, and a command that gave up says so (LOCK_TIMEOUT_ADVICE).
 */
function readOnly<T>(db: Pick<Db, "transaction">, read: (tx: Pick<Db, "select">) => Promise<T>): Promise<T> {
  return db.transaction(
    async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      return read(tx);
    },
    { accessMode: "read only" },
  );
}

/**
 * The staff keys of the live account at `email`, or of every live account whose role is not user; null when no live
 * account has that address. Keys and accounts are read on the auth role, the handles on the API role, which holds the
 * profiles, each in a read-only transaction of its own that waits at most 10 seconds for a lock: keys is the runbook's
 * check against an API under an attacker's control, which must not be able to hang it. A key's public key and
 * credential id are never read.
 */
export async function listStaffKeys(db: { api: Pick<Db, "transaction">; auth: Pick<Db, "transaction"> }, email: string | null): Promise<StaffKeysListing[] | null> {
  const read = await readOnly(db.auth, async (auth) => {
    const accounts = await auth
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(and(isNull(users.deletedAt), email === null ? ne(users.role, "user") : sql`lower(${users.email}) = lower(${email})`))
      .orderBy(asc(users.email));
    if (accounts.length === 0) return { accounts, keys: [] };
    const keys = await auth
      .select({
      id: staffKeys.id,
      userId: staffKeys.userId,
      name: staffKeys.name,
      aaguid: staffKeys.aaguid,
      createdAt: staffKeys.createdAt,
      lastUsedAt: staffKeys.lastUsedAt,
        revokedAt: staffKeys.revokedAt,
        suspectAt: staffKeys.suspectAt,
      })
      .from(staffKeys)
      .where(inArray(staffKeys.userId, accounts.map((account) => account.id)))
      .orderBy(asc(staffKeys.createdAt), asc(staffKeys.id));
    return { accounts, keys };
  });
  const { accounts, keys } = read;
  if (email !== null && accounts.length === 0) return null;
  if (accounts.length === 0) return [];
  const ids = accounts.map((account) => account.id);
  const handles = new Map(
    (await readOnly(db.api, (api) => api.select({ id: profiles.id, handle: profiles.handle }).from(profiles).where(inArray(profiles.id, ids)))).map((p) => [p.id, p.handle]),
  );
  return accounts.map((account) => ({
    ...account,
    handle: handles.get(account.id) ?? null,
    keys: keys.filter((key) => key.userId === account.id).map(({ userId: _owner, ...key }) => key),
  }));
}

/**
 * How keys prints: each account on a line, its keys indented below it. A name is printed as a JSON string, so a quote or
 * a character a terminal would act on is shown escaped, never acted on. A zero AAGUID means the browser or the
 * authenticator withheld its model; none, that the account's deletion blanked it.
 */
export function describeStaffKeys(listing: StaffKeysListing[]): string[] {
  if (listing.length === 0) return ["no staff account"];
  const lines: string[] = [];
  for (const account of listing) {
    lines.push(`${account.role} ${account.email} ${account.handle === null ? "(no handle)" : `@${account.handle}`} (account ${account.id})`);
    if (account.keys.length === 0) lines.push("  no staff keys");
    for (const key of account.keys) {
      const state = key.revokedAt === null ? "live" : `revoked ${key.revokedAt.toISOString()}${key.suspectAt ? `, suspect ${key.suspectAt.toISOString()}` : ""}`;
      lines.push(
        `  key ${key.id} ${JSON.stringify(key.name)}: AAGUID ${key.aaguid ?? "none"}, created ${key.createdAt.toISOString()}, ` +
          `last used ${key.lastUsedAt ? key.lastUsedAt.toISOString() : "never"}, ${state}`,
      );
    }
  }
  return lines;
}

// ---------------------------------------------------------------- audit-head

/**
 * The newest row's place, hash and time, read with audit_head in one statement, and whether the head names that row. An
 * empty log's head is place 0 with 64 zeros.
 */
export async function readAuditHead(db: Db): Promise<{ ok: true; place: KeptPlace; createdAt: Date | null } | { ok: false; problem: string }> {
  return db.transaction(
    async (tx) => {
      await readingSettings(tx);
      const newest = tx
        .select({ seq: auditLog.chainSeq, hash: auditLog.hash, createdAt: auditLog.createdAt })
        .from(auditLog)
        .orderBy(desc(auditLog.chainSeq))
        .limit(1)
        .as("newest");
      const [row] = await tx
        .select({ headSeq: auditHead.seq, headHash: auditHead.hash, seq: newest.seq, hash: newest.hash, createdAt: newest.createdAt })
        .from(auditHead)
        .leftJoin(newest, sql`true`)
        .where(eq(auditHead.id, 1));
      if (!row) return { ok: false as const, problem: "the audit head is missing" };
      const head = { seq: row.headSeq, hash: row.headHash };
      if (row.seq === null || row.hash === null) {
        if (head.seq === 0 && head.hash === CHAIN_ZERO_HASH) return { ok: true as const, place: head, createdAt: null };
        return { ok: false as const, problem: `the head names ${head.seq}:${head.hash}, but the audit log holds no row` };
      }
      if (row.seq !== head.seq || row.hash !== head.hash) {
        return { ok: false as const, problem: `the head names ${head.seq}:${head.hash}, but the newest row is ${row.seq}:${row.hash}` };
      }
      return { ok: true as const, place: head, createdAt: row.createdAt };
    },
    { accessMode: "read only" },
  );
}

// ---------------------------------------------------------------- the command

export interface Output {
  log(line: string): void;
  error(line: string): void;
}

/** Runs one command and answers its exit code: 0 when it holds, 1 when it found a problem or failed, 2 for the usage. */
export async function runStaffCommand(args: readonly string[], env: Record<string, string | undefined> = process.env, out: Output = console): Promise<number> {
  let command: StaffCommand;
  try {
    command = parseStaffArgs(args);
  } catch (err) {
    out.error((err as Error).message);
    return 2;
  }
  if (command.command === "enroll") return runEnroll(command.email, env, out);
  if (command.command === "revoke") return runRevoke(command.email, command.key, env, out);
  let urls: { api: string; auth: string | null };
  try {
    urls = staffDatabaseUrls(command, env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  // The command line's own connections: the record on the API's role, which may only read it, and the staff keys on the
  // auth role's, which audit-verify checks the record against.
  const apiDb = createDb(urls.api, { max: 1 });
  const authDb = urls.auth === null ? null : createDb(urls.auth, { max: 1 });
  try {
    if (command.command === "audit-head") {
      const head = await readAuditHead(apiDb);
      if (!head.ok) {
        out.error(`audit-head: ${head.problem}; run audit-verify`);
        return 1;
      }
      out.log(`${head.place.seq}:${head.place.hash} ${head.createdAt ? head.createdAt.toISOString() : "(the audit log is empty)"}`);
      return 0;
    }
    if (command.command === "keys") {
      const listing = await listStaffKeys({ api: apiDb, auth: authDb! }, command.email);
      if (listing === null) {
        out.error(`keys: no live account for ${command.email}`);
        return 1;
      }
      for (const line of describeStaffKeys(listing)) out.log(line);
      return 0;
    }
    const report = await auditVerify({ api: apiDb, auth: authDb! }, command.kept);
    for (const line of describeReport(report)) {
      if (report.ok) out.log(line);
      else out.error(line);
    }
    return report.ok ? 0 : 1;
  } catch (err) {
    out.error(isLockTimeout(err) ? `${command.command}: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await Promise.allSettled([closeDb(apiDb), ...(authDb ? [closeDb(authDb)] : [])]);
  }
}

/** enroll, on the migrator's own connection: its settings first, so a console that is off connects to nothing. */
async function runEnroll(email: string, env: Record<string, string | undefined>, out: Output): Promise<number> {
  let settings: EnrollSettings;
  try {
    settings = enrollSettings(env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const migrateDb = createDb(settings.migrate, { max: 1 });
  try {
    const issued = await issueEnrolment(migrateDb, email, settings);
    if (!issued.ok) {
      out.error(`enroll: ${issued.problem}; no link was issued`);
      return 1;
    }
    for (const line of describeEnrolment(issued, settings.consoleOrigin)) out.log(line);
    return 0;
  } catch (err) {
    out.error(isLockTimeout(err) ? `enroll: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await closeDb(migrateDb);
  }
}

// ---------------------------------------------------------------- revoke

/** What revoke prints of what it did. */
export function describeRevocation(report: Extract<StaffKeysRevokedReport, { ok: true }>, email: string, key: string | "all"): string[] {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (key !== "all" && report.alreadyRevokedAt !== null) {
    return [`revoke: staff key ${key} of ${email} was already revoked at ${report.alreadyRevokedAt.toISOString()}; nothing changed`];
  }
  if (report.keys.length === 0 && report.staffSessionsRevoked === 0 && report.enrollmentsCancelled === 0) {
    return [`revoke: ${email} has nothing to revoke: no live staff key, staff session or unused enrolment link; nothing changed`];
  }
  const lines = [
    `revoke: ${email}: ${count(report.keys.length, "staff key", "staff keys")} revoked, ${count(report.staffSessionsRevoked, "staff session", "staff sessions")} revoked` +
      (key === "all" ? `, ${count(report.enrollmentsCancelled, "unused enrolment link", "unused enrolment links")} deleted` : ""),
  ];
  // A name is printed as a JSON string, as keys prints it, so a character a terminal would act on is shown escaped.
  for (const revoked of report.keys) lines.push(`  key ${revoked.id} ${JSON.stringify(revoked.name)}: ${count(revoked.sessionsRevoked, "staff session", "staff sessions")} revoked`);
  return lines;
}

/** revoke, on the command line's own connection on the auth role: its settings first, so a missing one connects to nothing. */
async function runRevoke(email: string, key: string | "all", env: Record<string, string | undefined>, out: Output): Promise<number> {
  let settings: RevokeSettings;
  try {
    settings = revokeSettings(env);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const authDb = createDb(settings.auth, { max: 1 });
  try {
    const report = await revokeStaffKeys({ repo: createAuthRepo(authDb), mailer: mailerFor(settings.mail) }, email, key);
    if (!report.ok) {
      out.error(report.reason === "no_account" ? `revoke: no live account for ${email}; nothing changed` : `revoke: no staff key ${key} on ${email}; nothing changed`);
      return 1;
    }
    for (const line of describeRevocation(report, email, key)) out.log(line);
    // The revocation stands whatever the mail does; the operator tells the person another way.
    if (report.mailError !== null) out.error(`warning: the staff_keys_revoked mail to the account could not be sent (${report.mailError}); the revocation stands`);
    return 0;
  } catch (err) {
    out.error(isLockTimeout(err) ? `revoke: ${LOCK_TIMEOUT_ADVICE}` : err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    await closeDb(authDb);
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void runStaffCommand(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
```

### Replace `packages/contracts/src/staff.ts` (whole file)

```ts
import { z } from "zod";
import { DisplayName, OpaqueId, Role } from "./auth";
import { AuthenticationResponseJSON, PasskeyOptionsResponse, RegistrationResponseJSON } from "./passkeys";

// The staff console (3a design, section 10). The console talks only to /api/staff/* on its own origin, and parses every
// answer with these schemas; the API validates every request with them.

/**
 * Every code the staff flows put in ErrorEnvelope.error.code. Staff routes may also answer the shared challenge_expired,
 * rate_limited and invalid_request, and the staff gate's not_found and csrf_failed, but never a passkey_* code.
 */
export const StaffErrorCode = z.enum([
  "staff_session_required",
  "staff_key_invalid",
  "staff_key_suspended",
  "staff_key_limit",
  "staff_key_not_device_bound",
  "staff_key_not_user_verified",
  "staff_key_refused",
  "staff_enrollment_invalid",
  "staff_step_up_required",
  "staff_step_up_invalid",
]);
export type StaffErrorCode = z.infer<typeof StaffErrorCode>;

/** The roles that open the console: an account whose role is user holds no staff key. */
export const StaffRole = Role.exclude(["user"]);
export type StaffRole = z.infer<typeof StaffRole>;

/**
 * The name a staff key's holder gives it at enrolment, under the display-name rules. The authenticator shows it (it is the
 * registration's user name), so the console asks for neither an email nor a real name.
 */
export const StaffKeyName = DisplayName;

/** Which button the enrolment page offered: a roaming security key (sent with the security-key hint) or this computer's Windows Hello (no hint). */
export const StaffKeyKind = z.enum(["security_key", "this_device"]);
export type StaffKeyKind = z.infer<typeof StaffKeyKind>;

/** A lowercase hex sha256: chain hashes and action hashes. */
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase hex sha256");

/** A row's place in the audit chain (chain_seq): 1 for the first row. */
const ChainSeq = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * A place as a query string names it: a decimal without a sign, a leading zero or an exponent, and at most 15 digits, so
 * it always converts to a safe integer.
 */
const ChainSeqParam = z
  .string()
  .regex(/^[1-9][0-9]{0,14}$/, "must be a place in the audit chain: a positive whole number")
  .transform(Number);

// ---------------------------------------------------------------- keys, sessions and the account

/** One of the person's staff keys as the console lists them: never the public key, the credential id or the AAGUID. */
export const StaffKey = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type StaffKey = z.infer<typeof StaffKey>;

export const StaffKeysResponse = z.object({ keys: z.array(StaffKey) });
export type StaffKeysResponse = z.infer<typeof StaffKeysResponse>;

/**
 * One of the person's live staff sessions. `handle` is the session's random handle, which the revocation route takes;
 * `browser` is the coarse label ("Firefox on Linux"), never the user agent or an address.
 */
export const StaffSession = z.object({
  handle: z.uuid(),
  browser: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  /** The session this request came from. */
  current: z.boolean(),
});
export type StaffSession = z.infer<typeof StaffSession>;

export const StaffSessionsResponse = z.object({ sessions: z.array(StaffSession) });
export type StaffSessionsResponse = z.infer<typeof StaffSessionsResponse>;

/**
 * GET /api/staff/me: the account's handle and role, the session's handle (the console binds step-up challenges to it) and
 * both expiries with the seconds left, counted on the server, so the console's idle timer needs no clock of its own.
 */
export const StaffMe = z
  .object({
    handle: z.string(),
    role: StaffRole,
    sessionHandle: z.uuid(),
    idleExpiresAt: z.iso.datetime(),
    idleSecondsLeft: z.number().int().nonnegative(),
    absoluteExpiresAt: z.iso.datetime(),
    absoluteSecondsLeft: z.number().int().nonnegative(),
  })
  // The idle expiry never moves past the absolute one (the database checks it too).
  .refine((me) => me.idleSecondsLeft <= me.absoluteSecondsLeft, { message: "the idle end cannot lie beyond the absolute end", path: ["idleSecondsLeft"] });
export type StaffMe = z.infer<typeof StaffMe>;

// ---------------------------------------------------------------- enrolment

/** POST /api/staff/enroll/options: the token of the link `staff.js enroll` printed, the key's name and its kind. */
export const StaffEnrollOptionsRequest = z.object({ token: OpaqueId, name: StaffKeyName, kind: StaffKeyKind });
export type StaffEnrollOptionsRequest = z.infer<typeof StaffEnrollOptionsRequest>;

/**
 * The registration options, and whether the console's relying party ID is the app's (`rpShared`, true in development).
 * Only when it is not does the page ask the password manager to drop a refused credential through the Signal API.
 */
export const StaffEnrollOptionsResponse = PasskeyOptionsResponse.extend({ rpShared: z.boolean() });
export type StaffEnrollOptionsResponse = z.infer<typeof StaffEnrollOptionsResponse>;

/** POST /api/staff/enroll/verify: the same token and name with the browser's registration response. */
export const StaffEnrollVerifyRequest = z.object({ token: OpaqueId, name: StaffKeyName, response: RegistrationResponseJSON });
export type StaffEnrollVerifyRequest = z.infer<typeof StaffEnrollVerifyRequest>;

/** The key the enrolment stored; the person then signs in with it once. */
export const StaffEnrollVerifyResponse = z.object({ key: StaffKey });
export type StaffEnrollVerifyResponse = z.infer<typeof StaffEnrollVerifyResponse>;

// ---------------------------------------------------------------- sign-in

/** POST /api/staff/signin/options takes no body and answers with discoverable-credential options. */
export const StaffSignInOptionsResponse = PasskeyOptionsResponse;
export type StaffSignInOptionsResponse = z.infer<typeof StaffSignInOptionsResponse>;

/** POST /api/staff/signin/verify: the browser's assertion. There is no device id: a staff session is its own record. */
export const StaffSignInVerifyRequest = z.object({ response: AuthenticationResponseJSON });
export type StaffSignInVerifyRequest = z.infer<typeof StaffSignInVerifyRequest>;

/** A sign-in answers with the new session as /me describes it, beside the two staff cookies. */
export const StaffSignInVerifyResponse = StaffMe;
export type StaffSignInVerifyResponse = z.infer<typeof StaffSignInVerifyResponse>;

// ---------------------------------------------------------------- step-up

/**
 * A uuid in the one spelling PostgreSQL writes, lower-case hex. A step-up target's id is hashed exactly as sent, but the
 * database finds a uuid by value whatever its case and the audit row records the id as the database returns it: an
 * upper-case spelling would act on the row and leave a record whose target no longer hashes to the confirmed action, which
 * audit-verify would refuse for good. So any other spelling is refused, never changed.
 */
const LowerCaseUuid = z.uuid().regex(/^[0-9a-f-]+$/, { message: "a uuid in lower case" });

/**
 * Every action a staff key confirms, one at a time (3a design, section 7): the type of its target, the schema of the
 * target's id and the schema of its params. The step-up options, requireStaffStepUp, audit-verify and the console read it.
 * The params are hashed exactly as sent, so their schemas are strict: a member they do not know is refused, never dropped.
 */
export const STAFF_STEP_UP_ACTIONS = {
  /** DELETE /api/staff/sessions/:handle: one of the person's own staff sessions, by its handle. */
  staff_session_revoked: { targetType: "staff_session", targetId: LowerCaseUuid, params: z.strictObject({}) },
} as const;
export type StaffStepUpAction = keyof typeof STAFF_STEP_UP_ACTIONS;

export const StaffStepUpActionName = z.enum(Object.keys(STAFF_STEP_UP_ACTIONS) as [StaffStepUpAction, ...StaffStepUpAction[]]);

/** The `{ action, target, params }` of one step-up action, each part checked by that action's own schemas. */
function stepUpRequest<A extends StaffStepUpAction>(action: A) {
  const spec = STAFF_STEP_UP_ACTIONS[action];
  return z.strictObject({
    action: z.literal(action),
    target: z.strictObject({ type: z.literal(spec.targetType), id: spec.targetId }),
    params: spec.params,
  });
}

/** POST /api/staff/step-up/options: the action the route will execute, as it will execute it. */
export const StaffStepUpOptionsRequest = z.discriminatedUnion("action", [stepUpRequest("staff_session_revoked")]);
export type StaffStepUpOptionsRequest = z.infer<typeof StaffStepUpOptionsRequest>;

/** The options: a challenge bound to the session and the action, and an allow list holding only the session's key. */
export const StaffStepUpOptionsResponse = PasskeyOptionsResponse;
export type StaffStepUpOptionsResponse = z.infer<typeof StaffStepUpOptionsResponse>;

/** DELETE /api/staff/sessions/:handle: the action's params (none) with the step-up assertion added as `stepUp`. */
export const StaffSessionRevokeRequest = STAFF_STEP_UP_ACTIONS.staff_session_revoked.params.extend({ stepUp: AuthenticationResponseJSON });
export type StaffSessionRevokeRequest = z.infer<typeof StaffSessionRevokeRequest>;

/**
 * Which ceremony a WebAuthn challenge was issued for: its second byte, in either layout below. A challenge answers only
 * the ceremony it names. The API's codec writes these codes, and the console checks them before it asks for the key, so
 * no challenge of one ceremony is ever signed in another.
 */
export const CHALLENGE_PURPOSES = { signin: 1, register: 2, reauth: 3, staff_signin: 4, staff_register: 5, staff_step_up: 6 } as const;

/**
 * The layout of every challenge but the step-up's (1c's codec, 3a design, section 5): version, purpose, expiry (epoch
 * milliseconds, big-endian), nonce, a 16-byte binding (the first 16 bytes of the sha256 of the session's handle or the
 * staff enrolment's id it is bound to, zeros for the two sign-ins), then the first 16 bytes of an HMAC over the 42 bytes
 * before it, 58 bytes sent as unpadded base64url. The API's codec writes it, and the console checks the staff sign-in's
 * and the staff registration's before it asks for the key.
 */
export const CEREMONY_CHALLENGE = {
  bytes: 58,
  encodedLength: 78,
  version: 1,
  versionAt: 0,
  purposeAt: 1,
  expiryAt: 2,
  expiryBytes: 8,
  nonceAt: 10,
  nonceBytes: 16,
  bindingAt: 26,
  bindingBytes: 16,
  sealAt: 42,
  sealBytes: 16,
} as const;

/**
 * The step-up challenge's layout (3a design, section 5), which the API's codec writes, audit-verify reads back from a
 * stored assertion without the sealing key, and the console checks before it asks for the key: version, purpose, expiry
 * (epoch milliseconds, big-endian), nonce, the full 32-byte binding, then the first 16 bytes of an HMAC over the 58 bytes
 * before it, 74 bytes sent as unpadded base64url. The other ceremonies' challenges are 58 bytes with purposes 1 to 5 and a
 * 16-byte binding (CEREMONY_CHALLENGE), so neither layout is ever read as the other.
 */
export const STAFF_STEP_UP_CHALLENGE = {
  bytes: 74,
  encodedLength: 99,
  version: 1,
  purpose: CHALLENGE_PURPOSES.staff_step_up,
  versionAt: 0,
  purposeAt: 1,
  expiryAt: 2,
  expiryBytes: 8,
  nonceAt: 10,
  nonceBytes: 16,
  bindingAt: 26,
  bindingBytes: 32,
  sealAt: 58,
  sealBytes: 16,
} as const;

/** What a step-up confirms: an action, its target and its params, as the route will execute them, or as an audit row records them. */
export interface StaffStepUpActionInput {
  action: string;
  target: { type: string; id: string };
  params: Record<string, unknown>;
}

/**
 * JSON with every object's keys sorted and no whitespace. Keys are sorted by UTF-16 code units (Array.prototype.sort's
 * order), and strings and numbers are written as JSON.stringify writes them, so the API, audit-verify and the console write
 * the same text. Anything JSON cannot carry is refused rather than dropped or changed, as JSON.stringify would.
 */
function sortedJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("a step-up action's params hold only JSON values: a number must be finite");
    return JSON.stringify(value);
  }
  // Array.from visits holes too, so a sparse array is refused as undefined.
  if (Array.isArray(value)) return `[${Array.from(value, sortedJson).join(",")}]`;
  if (typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${sortedJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`a step-up action's params hold only JSON values, not ${value instanceof Object ? value.constructor.name : typeof value}`);
}

/**
 * The text an action's hash is taken over (3a design, section 7, Step-up): the sorted JSON of `{ action, target: { type,
 * id }, params }`. The step-up options take it from what the console sent, requireStaffStepUp from what the route is about
 * to do, audit-verify from the row's action, target and `metadata.params`, and the console from what it chose.
 */
export function stepUpActionText(input: StaffStepUpActionInput): string {
  return sortedJson({ action: input.action, target: { type: input.target.type, id: input.target.id }, params: input.params });
}

/**
 * The text a step-up challenge's binding is the sha256 of: the staff session's handle, a newline and the action's hash. A
 * confirmation made in one session, or for one action, therefore binds nothing else.
 */
export function stepUpBindingText(sessionHandle: string, actionHash: string): string {
  return `${sessionHandle}\n${actionHash}`;
}

/**
 * The parts of the Web Crypto and Encoding APIs the hashes below use. Browsers and Node (from 19) both have them as
 * globals; the contracts are compiled without the DOM's or Node's types, so only these members are declared.
 */
interface WebPlatform {
  crypto: { subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> } };
  TextEncoder: new () => { encode(text: string): Uint8Array };
}

async function sha256(text: string): Promise<Uint8Array> {
  const platform = globalThis as unknown as WebPlatform;
  return new Uint8Array(await platform.crypto.subtle.digest("SHA-256", new platform.TextEncoder().encode(text)));
}

/** The action's hash: the lower-case hex sha256 of stepUpActionText's UTF-8 bytes. */
export async function stepUpActionHash(input: StaffStepUpActionInput): Promise<string> {
  return Array.from(await sha256(stepUpActionText(input)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The step-up challenge's binding: all 32 bytes of the sha256 of stepUpBindingText's UTF-8 bytes. */
export async function stepUpBinding(sessionHandle: string, actionHash: string): Promise<Uint8Array> {
  return sha256(stepUpBindingText(sessionHandle, actionHash));
}

/**
 * A step-up assertion as the audit row stores it in `step_up`: the three members `audit-verify` checks, base64url exactly
 * as the browser sent them, under the same bounds as the browser's answer.
 */
export const StaffStoredAssertion = z.strictObject(
  AuthenticationResponseJSON.shape.response.pick({ authenticatorData: true, clientDataJSON: true, signature: true }).shape,
);
export type StaffStoredAssertion = z.infer<typeof StaffStoredAssertion>;

// ---------------------------------------------------------------- the audit log

/** How many rows one page of the audit log holds. */
export const STAFF_AUDIT_PAGE_SIZE = 50;

/**
 * One row of the audit log as the console shows it: its place and hash in the chain, when it joined the chain, the actor's
 * handle (null for the system actor or an account without one), the action, its target and the action's hash when a
 * step-up confirmed it. Never its metadata.
 */
export const AuditEntry = z.object({
  seq: ChainSeq,
  hash: Sha256Hex,
  createdAt: z.iso.datetime(),
  actorHandle: z.string().nullable(),
  action: z.string().min(1),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  actionHash: Sha256Hex.nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/** Newest first by place. `nextCursor` asks for the rows before this page's last one; null when there are none. */
export const AuditPage = z.object({ entries: z.array(AuditEntry).max(STAFF_AUDIT_PAGE_SIZE), nextCursor: ChainSeq.nullable() });
export type AuditPage = z.infer<typeof AuditPage>;

/**
 * GET /api/staff/audit: from the newest row, from before `cursor`, or the page whose newest row is at place `at` (the
 * keeper's "Go to place"); `action=staff_sign_in` is the reader's one filter, which the home screen's list of sign-ins reads.
 */
export const AuditPageQuery = z
  .object({ cursor: ChainSeqParam.optional(), at: ChainSeqParam.optional(), action: z.enum(["staff_sign_in"]).optional() })
  .refine((query) => query.cursor === undefined || query.at === undefined, { message: "ask for a cursor or a place, not both", path: ["at"] });
export type AuditPageQuery = z.infer<typeof AuditPageQuery>;
```

### Replace `packages/db/migrations/meta/_journal.json` (whole file)

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    {
      "idx": 0,
      "version": "7",
      "when": 1789374373025,
      "tag": "0000_parallel_umar",
      "breakpoints": true
    },
    {
      "idx": 1,
      "version": "7",
      "when": 1789374374757,
      "tag": "0001_grants",
      "breakpoints": true
    },
    {
      "idx": 2,
      "version": "7",
      "when": 1789388768464,
      "tag": "0002_aspiring_prism",
      "breakpoints": true
    },
    {
      "idx": 3,
      "version": "7",
      "when": 1789388790249,
      "tag": "0003_auth_events_grants",
      "breakpoints": true
    },
    {
      "idx": 4,
      "version": "7",
      "when": 1789639555282,
      "tag": "0004_young_bloodscream",
      "breakpoints": true
    },
    {
      "idx": 5,
      "version": "7",
      "when": 1789976535081,
      "tag": "0005_huge_scarlet_spider",
      "breakpoints": true
    },
    {
      "idx": 6,
      "version": "7",
      "when": 1789976685374,
      "tag": "0006_nifty_blue_shield",
      "breakpoints": true
    },
    {
      "idx": 7,
      "version": "7",
      "when": 1790237989056,
      "tag": "0007_auth_purge_events",
      "breakpoints": true
    },
    {
      "idx": 8,
      "version": "7",
      "when": 1790238603639,
      "tag": "0008_careless_shadowcat",
      "breakpoints": true
    },
    {
      "idx": 9,
      "version": "7",
      "when": 1790241720737,
      "tag": "0009_clever_ezekiel",
      "breakpoints": true
    },
    {
      "idx": 10,
      "version": "7",
      "when": 1790332470171,
      "tag": "0010_free_thunderbolt",
      "breakpoints": true
    },
    {
      "idx": 11,
      "version": "7",
      "when": 1790586983460,
      "tag": "0011_magical_iceman",
      "breakpoints": true
    },
    {
      "idx": 12,
      "version": "7",
      "when": 1790769406818,
      "tag": "0012_aberrant_wendell_vaughn",
      "breakpoints": true
    },
    {
      "idx": 13,
      "version": "7",
      "when": 1790876150318,
      "tag": "0013_forget_revoked_staff_keys",
      "breakpoints": true
    }
  ]
}
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
Done in 2s using pnpm v10.30.0
```

## Step 5: verify: typecheck

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

## Step 6: verify: test

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
packages/contracts test:       Tests  141 passed (141)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  108 passed (108)
apps/admin test:       Tests  228 passed (228)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  551 passed | 455 skipped (1006)
```

## Step 7: verify: admin-test

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
Tests  228 passed (228)
```

## Step 8: verify: admin-browser

```bash
pnpm --filter @korbat/admin test:browser
```

Expected output contains:

- `Tests  14 passed (14)`

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  14 passed (14)
```

## Step 9: verify: generate

```bash
pnpm --filter @korbat/db generate
```

Expected output contains:

- `No schema changes`

Observed on the dry run:

```text
No schema changes, nothing to migrate 😴
```

## Step 10: verify: apply-migrations

```bash
(cd apps/api && set -a && . ./.env && set +a && node --import tsx src/migrate.ts | sed -E 's#from .*#from packages/db/migrations#') && echo count=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc 'select count(*) from drizzle.__drizzle_migrations')
```

Expected output contains:

- `migrations applied`
- `count=14`

Observed on the dry run:

```text
migrations applied from packages/db/migrations
count=14
```

## Step 11: verify: chain

```bash
echo chain=$(docker compose -f infra/compose.yml -f infra/compose.dev.yml exec -T postgres psql -U postgres -d korbat -tAc "select coalesce(min(chain_seq), 1) = 1 and count(*) = coalesce(max(chain_seq), 0) and not exists (select 1 from (select prev_hash, lag(hash) over (order by chain_seq) as p from public.audit_log) x where x.prev_hash <> coalesce(x.p, repeat('0', 64))) and not exists (select 1 from public.audit_log a where a.hash <> encode(sha256(convert_to(a.prev_hash || public.audit_chain_text(a), 'UTF8')), 'hex')) and (select hash from public.audit_head) = coalesce((select hash from public.audit_log order by chain_seq desc limit 1), repeat('0', 64)) from public.audit_log")
```

Expected output contains:

- `chain=t`

Observed on the dry run:

```text
chain=t
```

## Step 12: verify: test-database-0013

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

## Step 13: verify: integration

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
Tests  453 passed (453)
```

## Step 14: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 15: verify: staff-cli

```bash
node --check apps/api/dist/staff.js && node apps/api/dist/staff.js 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings; echo staff-exit=${PIPESTATUS[0]}
```

Expected output contains:

- `usage: node dist/staff.js <command>`
- `revoke <email> all`
- `audit-verify [<chain_seq>:<hash> ...]`
- `staff-exit=2`

Observed on the dry run:

```text
usage: node dist/staff.js <command>
audit-verify [<chain_seq>:<hash> ...]  recompute the audit chain and check it against places kept before
revoke <email> all                     revoke every staff key and staff session of the account, delete its unused
staff-exit=2
```

## Step 16: verify: audit-verify-dev

```bash
cd apps/api && set -a && . ./.env && set +a && node dist/staff.js audit-verify 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings; echo verify-exit=${PIPESTATUS[0]}
```

Expected output contains:

- `audit-verify: the chain holds:`
- `staff keys checked`
- `verify-exit=0`

Observed on the dry run:

```text
audit-verify: the chain holds: 69 rows, from place 1 to the head 69:0e68f00f701fe1a850cd84eb5e420511669458b179b64e61638c3f9ef51bef39
2 staff keys checked
verify-exit=0
```

## Step 17: verify: compose-config

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok
```

Expected output contains:

- `config-ok`

Observed on the dry run:

```text
config-ok
```

## Step 18: verify: stack-down

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok
```

Expected output contains:

- `down-ok`

Observed on the dry run:

```text
down-ok
```

## Step 19: verify: build

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml build > .data/stack-build.log 2>&1; echo build-exit=$?; tail -3 .data/stack-build.log
```

Expected output contains:

- `build-exit=0`

Observed on the dry run:

```text
build-exit=0
```

## Step 20: verify: stack-up

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok
```

Expected output contains:

- `up-ok`

Observed on the dry run:

```text
up-ok
```

## Step 21: verify: test-database

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

## Step 22: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --console http://localhost:$CONSOLE_PORT --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `smoke test passed`

Observed on the dry run:

```text
smoke test passed
```

## Step 23: verify: stack-stop

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker cloudflared 2>/dev/null; docker compose -f infra/compose.yml -f infra/compose.dev.yml ps --format '{{.Name}} {{.Status}}'
```

Expected output contains:

- `postgres-1 Up`

Observed on the dry run:

```text
korbat-postgres-1 Up 46 seconds (healthy)
```

## Step 24: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/admin/src/api.ts`
- `apps/admin/src/audit-log.ts`
- `apps/admin/src/challenge.ts`
- `apps/admin/src/enroll.ts`
- `apps/admin/src/messages.ts`
- `apps/admin/src/screens/Audit.tsx`
- `apps/admin/src/screens/Enroll.tsx`
- `apps/admin/src/screens/Home.tsx`
- `apps/admin/src/screens/SignIn.tsx`
- `apps/admin/src/sign-in.ts`
- `apps/admin/src/step-up.ts`
- `apps/admin/src/store.ts`
- `apps/admin/test/audit-log.test.ts`
- `apps/admin/test/browser/console.browser.ts`
- `apps/admin/test/browser/fixture-api.ts`
- `apps/admin/test/browser/watch.ts`
- `apps/admin/test/enroll.test.ts`
- `apps/admin/test/fixture-statuses.test.ts`
- `apps/admin/test/fixtures.ts`
- `apps/admin/test/screens.test.tsx`
- `apps/admin/test/sign-in.test.ts`
- `apps/admin/test/source.test.ts`
- `apps/admin/test/step-up.test.ts`
- `apps/admin/test/store.test.ts`
- `apps/admin/test/webauthn.test.ts`
- `apps/api/src/auth/admin.ts`
- `apps/api/src/auth/index.ts`
- `apps/api/src/auth/passkeys/challenge.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/src/auth/staff/enroll.ts`
- `apps/api/src/auth/staff/signin.ts`
- `apps/api/src/auth/staff/step-up.ts`
- `apps/api/src/cli/grant-role.ts`
- `apps/api/src/cli/staff.ts`
- `apps/api/test/auth/passkey-challenge.test.ts`
- `apps/api/test/cli-grant-role.test.ts`
- `apps/api/test/integration/audit-verify.test.ts`
- `apps/api/test/integration/auth-flows-account.test.ts`
- `apps/api/test/integration/cli-grant-role.test.ts`
- `apps/api/test/integration/cli-staff-enroll.test.ts`
- `apps/api/test/integration/http-staff-sessions.test.ts`
- `apps/api/test/integration/staff-lifecycle.test.ts`
- `apps/api/test/integration/staff-schema.test.ts`
- `apps/api/test/integration/staff-signin.test.ts`
- `apps/api/test/integration/staff-step-up.test.ts`
- `apps/api/test/staff/route-table.test.ts`
- `packages/contracts/src/staff.ts`
- `packages/contracts/test/staff.test.ts`
- `packages/db/migrations/0013_forget_revoked_staff_keys.sql`
- `packages/db/migrations/meta/0013_snapshot.json`
- `packages/db/migrations/meta/_journal.json`

## Step 25: commit

```bash
git add -A
git commit -q -m "fix(api,admin,contracts,db): what the review of 3a upheld, fixed: the console checks the layout and purpose of every challenge before it asks for a key, so an API under an attacker's control cannot get a sign-in or an enrolment to sign a step-up; audit-verify pages on place and id and fails on a place held twice, a row with no place or a row count that does not add up; a key enrolled for another origin or relying party opens and confirms nothing, and assertions are verified against the values recorded on the key; the enrolment page signs in with the new key itself; a confirmed action bounds its lock waits by its challenge's life and writes nothing once the database's clock is past the expiry; auth.forget_staff_keys blanks only revoked keys (migration 0013); demotion and take-down revoke keys before sessions; grant-role's tombstones and mail are best effort and reported; staff.js keys gives up on a held lock; the step-up binds the session read just before it; Go to place and Load older say and show what they read; and the tests the review found missing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `fix(api,admin,contracts,db): what the review of 3a upheld, fixed: the console checks the layout and purpose of every challenge before it asks for a key, so an API under an attacker's control cannot get a sign-in or an enrolment to sign a step-up; audit-verify pages on place and id and fails on a place held twice, a row with no place or a row count that does not add up; a key enrolled for another origin or relying party opens and confirms nothing, and assertions are verified against the values recorded on the key; the enrolment page signs in with the new key itself; a confirmed action bounds its lock waits by its challenge's life and writes nothing once the database's clock is past the expiry; auth.forget_staff_keys blanks only revoked keys (migration 0013); demotion and take-down revoke keys before sessions; grant-role's tombstones and mail are best effort and reported; staff.js keys gives up on a held lock; the step-up binds the session read just before it; Go to place and Load older say and show what they read; and the tests the review found missing`.

## Report format (mandatory)

```text
TASK 8 REPORT
Files written: <count, expected 51>
Failing-test step (the error line): <paste>
Verify "frozen-install": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "admin-test": <paste the expected lines as printed>
Verify "admin-browser": <paste the expected lines as printed>
Verify "generate": <paste the expected lines as printed>
Verify "apply-migrations": <paste the expected lines as printed>
Verify "chain": <paste the expected lines as printed>
Verify "test-database-0013": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Verify "staff-cli": <paste the expected lines as printed>
Verify "audit-verify-dev": <paste the expected lines as printed>
Verify "compose-config": <paste the expected lines as printed>
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
