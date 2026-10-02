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
