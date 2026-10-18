import { AUDIT_EXPORT_MAX, type RestoreGap, type RestoreView, type StaffOverview } from "@korbat/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ApiError, createStaffApi } from "../src/api";
import { checkDownload, downloadCopy, parseKeyFilter } from "../src/audit-log";
import { MODERATION_MESSAGES, RECOVERY_WORDS } from "../src/messages";
import { AuthoritiesLines } from "../src/screens/Home";
import { RestoreScreen, type RestoreScreenProps } from "../src/screens/Restore";
import { bothTimes } from "../src/ui";
import { fakeFetch } from "./fixtures";

/**
 * 3f Task 6 (design, sections 7.16, 8.2, 8.7 and 8.8): the console's side of recovery. The download's lines are held to
 * run from the place after the last copy to the head without a break before anything is saved, and the mark is posted
 * only after the file is saved; nothing newer asks for no key. After a restore lists the gaps by class in the order to
 * take them again, with the controls of 8.8 and nothing of a lost row. Home says how old the copy is and how many gaps
 * are open. Every sentence is the messages' own.
 */
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const text = (out: string) => out.replace(/<[^>]+>/g, "").replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
const LF = String.fromCharCode(10);
const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const AT = "2026-10-08T09:00:00.000Z";
const ID = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const CASE = "2c3d4e5f-6071-4b8c-9daf-1f2a3b4c5d6e";
const ORDER = "3d4e5f60-7182-4c9d-8ebf-2a3b4c5d6e7f";

const hashOf = (place: number) => place.toString(16).padStart(64, "0");
/** A line of the download at a place, naming the place before it. */
const line = (place: number, prev = hashOf(place - 1)) =>
  JSON.stringify({
    v: 1,
    place,
    id: place,
    at: AT,
    actor: ID,
    action: "probe",
    targetType: null,
    targetId: null,
    requestId: null,
    staffSession: null,
    keyId: null,
    actionHash: null,
    stepUp: null,
    metadata: "{}",
    prevHash: prev,
    hash: hashOf(place),
  });
const body = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => line(from + i)).join(LF) + LF;

describe("the download's check (7.16 step 4)", () => {
  test("lines that run from the place after the last copy to the head, each naming the one before, are held", () => {
    expect(checkDownload(body(5, 9), 4, 9)?.map((l) => l.place)).toEqual([5, 6, 7, 8, 9]);
  });

  test("a body cut short, a line missing, a line that names another, a line out of place or one that does not parse holds nothing", () => {
    expect(checkDownload(body(5, 7), 4, 9)).toBeNull();
    expect(checkDownload([line(5), line(7)].join(LF), 4, 7)).toBeNull();
    expect(checkDownload([line(5), line(6, "f".repeat(64))].join(LF), 4, 6)).toBeNull();
    expect(checkDownload(body(6, 9), 4, 9)).toBeNull();
    expect(checkDownload(`${line(5)}${LF}{"place": 6`, 4, 6)).toBeNull();
    expect(checkDownload("", 4, 5)).toBeNull();
  });
});

describe('"Download since my last copy" (7.16, 8.7)', () => {
  /** The download's three steps, recorded: what was asked, what was saved, what was marked. */
  function world(answer: (params: { after: number; through: number }) => Promise<string>, mark: () => Promise<void> = async () => undefined) {
    const steps: string[] = [];
    return {
      steps,
      deps: {
        exportAudit: async (params: { after: number; through: number }) => {
          steps.push(`export ${params.after} ${params.through}`);
          return answer(params);
        },
        markCopy: async (b: { through: number; hash: string }) => {
          steps.push(`mark ${b.through} ${b.hash.slice(-2)}`);
          await mark();
        },
        save: (name: string) => steps.push(`save ${name}`),
      },
    };
  }

  test("from the last copy to the head: the key's download, the file saved, then the mark with the last line's place and hash", async () => {
    const w = world(async ({ after, through }) => body(after + 1, through));
    expect(await downloadCopy(w.deps, 40, 45)).toEqual({ kind: "done", from: 41, to: 45, rows: 5 });
    expect(w.steps).toEqual(["export 40 45", "save korbat-audit-41-45.jsonl", "mark 45 2d"]);
    // Before the first copy it starts after place 0, and a long log is taken AUDIT_EXPORT_MAX rows at a time.
    const first = world(async ({ after, through }) => body(after + 1, through));
    expect(await downloadCopy(first.deps, null, AUDIT_EXPORT_MAX + 7)).toEqual({ kind: "done", from: 1, to: AUDIT_EXPORT_MAX, rows: AUDIT_EXPORT_MAX });
  });

  test("nothing newer asks for no key; a body that broke off saves and marks nothing; a mark the database refused records nothing", async () => {
    const none = world(async () => "");
    expect(await downloadCopy(none.deps, 45, 45)).toEqual({ kind: "none", lastPlace: 45 });
    expect(none.steps).toEqual([]);
    const cut = world(async ({ after }) => body(after + 1, after + 2));
    expect(await downloadCopy(cut.deps, 40, 45)).toEqual({ kind: "broken" });
    expect(cut.steps).toEqual(["export 40 45"]);
    const dropped = world(async () => {
      throw new ApiError(0, "network");
    });
    expect(await downloadCopy(dropped.deps, 40, 45)).toEqual({ kind: "broken" });
    const refused = world(
      async ({ after, through }) => body(after + 1, through),
      async () => {
        throw new ApiError(409, "copy_mismatch");
      },
    );
    expect(await downloadCopy(refused.deps, 40, 45)).toEqual({ kind: "broken" });
    // Every other refusal (the key, a session that ended) is the screen's to word.
    const keyless = world(async () => {
      throw new ApiError(403, "staff_step_up_required");
    });
    await expect(downloadCopy(keyless.deps, 40, 45)).rejects.toMatchObject({ code: "staff_step_up_required" });
    expect(MODERATION_MESSAGES.copy_mismatch).toBe(RECOVERY_WORDS.broken);
  });

  test("the key filter: a key's id as staff.js keys prints it, and each end an instant or empty", () => {
    expect(parseKeyFilter(` ${ID.toUpperCase()} `, "", "")).toEqual({ key: ID });
    expect(parseKeyFilter(ID, "2026-10-10T01:00:00Z", "")).toEqual({ key: ID, from: "2026-10-10T01:00:00Z" });
    expect(parseKeyFilter("not a key", "", "")).toBeNull();
    expect(parseKeyFilter(ID, "yesterday", "")).toBeNull();
    expect(parseKeyFilter(ID, "2026-10-10T02:00:00Z", "2026-10-10T01:00:00Z")).toBeNull();
  });

  test("the API client: a decision that takes a lost one again names its gap; the key filter goes in the query", async () => {
    const fake = fakeFetch({
      [`POST /api/staff/cases/${CASE}/decisions?gap=${ID}`]: { status: 409, body: { error: { code: "gap_mismatch", message: "x", requestId: "r" } } },
      [`GET /api/staff/audit?key=${ID}&from=2026-10-10T01%3A00%3A00Z`]: { status: 200, body: { entries: [], nextCursor: null, copy: { lastPlace: 3 } } },
    });
    const api = createStaffApi({ fetch: fake.fetch, cookie: () => "" });
    await expect(api.decide(CASE, {} as never, {}, ID)).rejects.toMatchObject({ code: "gap_mismatch" });
    await expect(api.decide(CASE, {} as never, {}, "NOT-A-GAP")).rejects.toMatchObject({ code: "invalid_request" });
    expect((await api.audit({ key: ID, from: "2026-10-10T01:00:00Z" })).copy).toEqual({ lastPlace: 3 });
  });
});

describe("After a restore (8.8)", () => {
  const gap = (more: Partial<RestoreGap>): RestoreGap => ({
    id: ID,
    class: "restriction",
    actedAt: AT,
    action: "case_decided",
    caseId: CASE,
    orderId: null,
    itemId: null,
    kinds: ["remove"],
    closedAt: null,
    disposition: null,
    closedByDecisionId: null,
    ...more,
  });
  const view = (gaps: RestoreGap[], more: Partial<RestoreView> = {}): RestoreView => ({ importedAt: AT, mayOpen: false, retentionMay: false, gaps, holds: [], ...more });
  const props = (v: RestoreView, role: "moderator" | "admin" = "moderator"): RestoreScreenProps => ({ view: v, role, busy: null, notice: null, error: null, onOpenCase: () => undefined, onOpenOrder: () => undefined, onNotNeeded: () => undefined });
  const ids = (n: number) => `${n.toString(16).padStart(8, "0")}-1111-4222-8333-444455556666`;

  test("each class under its heading, in the order to take them again, with its line, and the order's disabling counted once a order", () => {
    const gaps = [
      gap({ id: ids(1), class: "order_effect", action: "order_effected", caseId: null, orderId: ORDER, itemId: ids(11), kinds: ["disable_by_order"] }),
      gap({ id: ids(2), class: "order_effect", action: "order_effected", caseId: null, orderId: ORDER, itemId: ids(12), kinds: ["disable_by_order"] }),
      gap({ id: ids(3), class: "seal_final", kinds: ["seal_media"] }),
      gap({ id: ids(4), class: "seal_interim", kinds: ["seal_media"] }),
      gap({ id: ids(5), class: "standing", kinds: ["suspend"] }),
      gap({ id: ids(6), class: "restriction", kinds: ["remove", "strike"] }),
      gap({ id: ids(7), class: "reversal", kinds: ["restore"] }),
      gap({ id: ids(8), class: "no_measure", kinds: [] }),
      gap({ id: ids(9), class: "record", action: "notification_recorded", caseId: null, kinds: [] }),
    ];
    const out = html(<RestoreScreen {...props(view(gaps))} />);
    const t = text(out);
    const W = RECOVERY_WORDS.classes;
    const headings = [...out.matchAll(/<h3[^>]*>([^<]+)<[/]h3>/g)].map((m) => m[1]);
    expect(headings).toEqual([W.order_effect.heading, W.seal_final.heading, W.seal_interim.heading, W.standing.heading, W.restriction.heading, W.reversal.heading, W.no_measure.heading, W.record.heading]);
    const at = bothTimes(AT);
    expect(t).toContain(W.order_effect.line(2, at));
    expect(t).toContain(W.restriction.line('"Remove", "Strike"', at));
    expect(t).toContain(W.record.line(at, RECOVERY_WORDS.recordWhat("notification_recorded")));
    expect(t).toContain(RECOVERY_WORDS.site);
    expect(t).toContain(RECOVERY_WORDS.what);
    expect(t).toContain(RECOVERY_WORDS.lost);
    // One link to the order, one to the case of each decision's gap, none for a record; no "Not needed" for a moderator.
    expect(out.match(/href="[^"]+"/g)).toEqual([`href="/orders/${ORDER}"`, ...Array.from({ length: 6 }, () => `href="/cases/${CASE}"`)]);
    expect(t).not.toContain(RECOVERY_WORDS.notNeeded);
    expect(html(<RestoreScreen {...props(view(gaps), "admin")} />).match(new RegExp(RECOVERY_WORDS.notNeeded, "g"))).toHaveLength(8);
  });

  test("the site and retention lines follow the view; the held notices are listed with their ends; a closed gap says how it closed", () => {
    const open = text(html(<RestoreScreen {...props(view([gap({ closedAt: AT, disposition: "not_needed" })], { mayOpen: true, retentionMay: true, holds: [{ orderId: ORDER, holdUntil: null }] }))} />));
    expect(open).toContain(RECOVERY_WORDS.siteOpen);
    expect(open).toContain(RECOVERY_WORDS.retention);
    expect(open).toContain(RECOVERY_WORDS.holds);
    expect(open).toContain(RECOVERY_WORDS.holdUntil(null));
    expect(open).toContain(RECOVERY_WORDS.closed("not_needed", bothTimes(AT)));
    expect(open).toContain(RECOVERY_WORDS.nothingOpen);
  });
});

describe("Home's [home.copy] and [home.restore] (8.2)", () => {
  const overview = (copy: StaffOverview["copy"], restore: StaffOverview["restore"]) =>
    ({ contact: { open: 0, oldestAt: null, dueAt: null }, alerts: { channel: "ok", since: null }, ordersUnverified: { total: 0, items: [] }, reportsOwed: { total: 0, items: [] }, copy, restore }) as unknown as StaffOverview;

  test("the copy's age in days while it is overdue, and that none was taken before the first; nothing while it is fresh", () => {
    const old = new Date(NOW - 3 * 86_400_000 - 60_000).toISOString();
    expect(text(html(<AuthoritiesLines overview={overview({ newestAt: old, overdue: true }, { open: 0, measures: 0, importedAt: null })} now={NOW} />))).toContain(RECOVERY_WORDS.homeCopy(3));
    expect(text(html(<AuthoritiesLines overview={overview({ newestAt: null, overdue: true }, { open: 0, measures: 0, importedAt: null })} now={NOW} />))).toContain(RECOVERY_WORDS.homeCopyNone);
    expect(html(<AuthoritiesLines overview={overview({ newestAt: old, overdue: false }, { open: 0, measures: 0, importedAt: null })} now={NOW} />)).toBe("");
  });

  test("the open gaps and the measures among them, a link to After a restore", () => {
    const out = html(<AuthoritiesLines overview={overview({ newestAt: null, overdue: false }, { open: 4, measures: 3, importedAt: AT })} now={NOW} onNavigate={() => undefined} />);
    expect(text(out)).toContain(RECOVERY_WORDS.homeRestore(4, 3));
    expect(out.match(/href="[^"]+"/g)).toEqual(['href="/restore"']);
  });
});
