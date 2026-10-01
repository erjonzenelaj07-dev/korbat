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
