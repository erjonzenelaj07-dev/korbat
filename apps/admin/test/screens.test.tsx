import type { AuditEntry, StaffKey, StaffMe, StaffOverview, StaffSession } from "@korbat/contracts";
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
  keyId: null,
});

const SESSIONS: StaffSession[] = [
  { handle: SESSION_HANDLE, browser: HOSTILE.img, createdAt: "2026-10-01T09:40:00.000Z", lastUsedAt: "2026-10-01T09:41:00.000Z", current: true },
  { handle: OTHER_SESSION, browser: HOSTILE.bidi, createdAt: "2026-10-01T07:00:00.000Z", lastUsedAt: "2026-10-01T07:30:00.000Z", current: false },
];

const KEYS: StaffKey[] = [
  { id: "5b0e4a52-3c1d-4f6e-9a8b-7c6d5e4f3a2b", name: HOSTILE.long, createdAt: "2026-09-01T10:00:00.000Z", lastUsedAt: null },
  { id: "6c1f5b63-4d2e-4a7f-8b9c-8d7e6f5a4b3c", name: HOSTILE.url, createdAt: "2026-09-02T10:00:00.000Z", lastUsedAt: "2026-10-01T09:40:00.000Z" },
];

/** A quiet day: no open case, nothing revealed, nothing waiting. */
const QUIET: StaffOverview = {
  lanes: [
    { lane: 0, open: 0, oldestAt: null },
    { lane: 1, open: 0, oldestAt: null },
    { lane: 2, open: 0, oldestAt: null },
  ],
  appealsWaiting: 0,
  appealsYouMayReview: 0,
  appealsWithoutReviewer: 0,
  reveals: { total: 0, items: [] },
  imagesToday: [],
  findingsToday: [],
  mailsWaiting: { receipts: 0, authorMails: 0, outcomes: 0 },
  mailsFailed: { receipts: 0, authorMails: 0, outcomes: 0 },
  releaseOverdue: 0,
  erasureOverdue: { caseEvidence: 0, intakeRecords: 0, statements: 0, redactions: 0, images: 0, drafts: 0, accessLog: 0, contacts: 0 },
  deferUnproven: false,
  protectionLifted: { total: 0, items: [] },
  sealsDeclined: { total: 0, items: [] },
  interimSeals: { total: 0, items: [] },
  // 3f: nothing at the contact point, and the alert channel working.
  contact: { open: 0, oldestAt: null, dueAt: null },
  alerts: { channel: "ok", since: null },
  ordersUnverified: { total: 0, items: [] },
  reportsOwed: { total: 0, items: [] },
  copy: { newestAt: "2026-10-01T08:00:00.000Z", overdue: false },
  restore: { open: 0, measures: 0, importedAt: null },
  quarantine: { dueIn: 0, dueOut: 0, undestroyed: 0, oldest: null },
  destructive: [],
  repliesWaiting: { count: 0, oldestAt: null },
  strikeAccounts: 0,
  // 3d Task 6: no measure of a program waits and nobody asked for a person.
  automated: { waiting: 0, oldestAt: null, objected: 0, oldestObjectionAt: null, cases: [], objectedCases: [] },
};

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
    overview: { state: "ready" as const, value: QUIET },
    now: Date.parse("2026-10-01T09:40:00.000Z"),
    onOpenCase: noop,
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
    // The cases' overview stands before the sign-ins; the placeholder line of 3a is gone.
    expect(out).not.toContain("Cases arrive in sub-project 3c.");
    expect(out).toContain("Urgent: no open case");
    expect(out.indexOf("Urgent: no open case")).toBeLessThan(out.indexOf("Staff sign-ins in the last 7 days"));
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
          copy: { lastPlace: null },
        },
      },
      "GET /api/staff/sessions": { status: 200, body: { sessions: [] } },
      "GET /api/staff/keys": { status: 200, body: { keys: [] } },
      "GET /api/staff/overview": { status: 200, body: QUIET },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    const store = createConsoleStore({ api, clock: new FakeClock(), path: "/", history: { pushState: noop, replaceState: noop } });
    await store.start();
    const held = store.get().session;
    if (held.kind !== "signed-in") throw new Error("the page holds no session");
    expect(serverNow(held.me)).toBe(pageOpened);

    // What the screen runs when it opens, with the session the page holds as its `me`.
    let signIns: Loadable<AuditEntry[]> = { state: "loading" };
    openHome(api, { current: true }, { overview: noop, signIns: (value) => (signIns = value), sessions: noop, keys: noop });
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
    { seq: 120, hash: "c".repeat(64), createdAt: "2026-10-01T09:00:05.000Z", actorHandle: HOSTILE.script, action: "staff_session_revoked", targetType: "staff_session", targetId: OTHER_SESSION, actionHash: "d".repeat(64), keyId: null },
    { seq: 119, hash: "e".repeat(64), createdAt: "2026-10-01T08:00:00.000Z", actorHandle: HOSTILE.bidi, action: HOSTILE.img, targetType: null, targetId: null, actionHash: null, keyId: null },
    { seq: 118, hash: "f".repeat(64), createdAt: "2026-10-01T07:00:00.000Z", actorHandle: null, action: "staff_key_added", targetType: "staff_key", targetId: HOSTILE.url, actionHash: null, keyId: null },
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
  const row = (seq: number): AuditEntry => ({ seq, hash: "c".repeat(64), createdAt: "2026-10-01T09:00:05.000Z", actorHandle: null, action: "staff_sign_in", targetType: null, targetId: null, actionHash: null, keyId: null });

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
