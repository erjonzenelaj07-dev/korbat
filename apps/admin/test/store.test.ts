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
