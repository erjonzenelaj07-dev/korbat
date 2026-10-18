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
    keyId: null,
  };
}

describe("the staff sign-ins of the last 7 days", () => {
  test("the server's now, from the session's absolute end and the seconds left to it, not the browser's clock", () => {
    expect(serverNow(makeMe({ at: NOW, absolute: 3600 }))).toBe(NOW);
    expect(SIGN_IN_WINDOW_MS).toBe(7 * DAY);
  });

  test("reads pages until it meets a sign-in older than 7 days, and keeps none older", async () => {
    const pages: AuditPage[] = [
      { entries: [signIn(1000), signIn(DAY)], nextCursor: 51, copy: { lastPlace: null } },
      { entries: [signIn(3 * DAY), signIn(7 * DAY - 1)], nextCursor: 40, copy: { lastPlace: null } },
      { entries: [signIn(7 * DAY + 1, "old_one"), signIn(8 * DAY, "older")], nextCursor: 30, copy: { lastPlace: null } },
      { entries: [signIn(9 * DAY, "never_read")], nextCursor: null, copy: { lastPlace: null } },
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
      return { entries: [signIn(DAY)], nextCursor: null, copy: { lastPlace: null } };
    }, NOW - 7 * DAY);
    expect(asked).toEqual([undefined]);
    expect(list).toHaveLength(1);
  });

  test("a cursor that does not move back stops the reading rather than loop", async () => {
    const asked: (number | undefined)[] = [];
    await readRecentSignIns(async (cursor) => {
      asked.push(cursor);
      return { entries: [signIn(DAY)], nextCursor: 51, copy: { lastPlace: null } };
    }, NOW - 7 * DAY);
    expect(asked).toEqual([undefined, 51]);
  });

  test("only sign-ins are listed, whatever else the answer holds", async () => {
    const other = { ...signIn(DAY), action: "staff_signed_out" };
    const list = await readRecentSignIns(async () => ({ entries: [other, signIn(DAY)], nextCursor: null, copy: { lastPlace: null } }), NOW - 7 * DAY);
    expect(list.map((e) => e.action)).toEqual(["staff_sign_in"]);
  });

  test("through the API: the filter on every page, each request marked as the person's opening of the screen", async () => {
    const fake = fakeFetch({
      "GET /api/staff/audit?action=staff_sign_in": { status: 200, body: { entries: [signIn(DAY)], nextCursor: 12, copy: { lastPlace: null } } },
      "GET /api/staff/audit?action=staff_sign_in&cursor=12": { status: 200, body: { entries: [signIn(8 * DAY)], nextCursor: 3, copy: { lastPlace: null } } },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    const list = await readRecentSignIns((cursor) => api.audit({ action: "staff_sign_in", cursor }, { activity: true }), NOW - 7 * DAY);
    expect(list).toHaveLength(1);
    expect(fake.requests.map((r) => `${r.url} ${r.headers["x-staff-activity"]}`)).toEqual(["/api/staff/audit?action=staff_sign_in 1", "/api/staff/audit?action=staff_sign_in&cursor=12 1"]);
  });

  test("at the screen's opening: the server's time from a marked /me read then, and the pages back to 7 days before it", async () => {
    const fake = fakeFetch({
      "GET /api/staff/me": { status: 200, body: makeMe({ at: NOW, absolute: 3600 }) },
      "GET /api/staff/audit?action=staff_sign_in": { status: 200, body: { entries: [signIn(DAY), signIn(7 * DAY - 1000), signIn(7 * DAY + 1000)], nextCursor: 40, copy: { lastPlace: null } } },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    const list = await readSignInsAtOpening(api);
    expect(list.map((e) => Date.parse(e.createdAt))).toEqual([NOW - DAY, NOW - 7 * DAY + 1000]);
    expect(fake.requests.map((r) => `${r.url} ${r.headers["x-staff-activity"]}`)).toEqual(["/api/staff/me 1", "/api/staff/audit?action=staff_sign_in 1"]);
  });
});
