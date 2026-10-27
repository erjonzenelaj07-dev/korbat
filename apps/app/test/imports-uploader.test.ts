import { createHash } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { IMPORT_RULES, ImportView, type ImportChoice } from "@korbat/contracts";
import { ApiError } from "../src/lib/api";
import {
  announcement,
  archiveProblem,
  chosenTotals,
  chunkHash,
  formatBytes,
  formatCount,
  importErrorMessage,
  imports,
  leftOutCounts,
  marksPass,
  monthInChoice,
  uploadArchive,
} from "../src/lib/imports";
import { IMPORT_WORDS } from "../src/lib/import-words";
import { fill } from "../src/lib/ui-words";

/**
 * The import's client (3b design, sections 4.2, 7.3, 9.2 and 10.3; Task 7): the chunked uploader against a fake fetch that
 * keeps the archive as the API does (7.3: a chunk at the stored offset, exactly chunkBytes but the last, its SHA-256 in
 * Import-Chunk-Sha256), and the pure functions the screens count and word with. The app imports no other app, so the
 * chosen totals are held here to the same table and answers as the API's apps/api/test/imports-plan.test.ts.
 */
const ID = "00000000-0000-4000-8000-000000000801";

/** An import as GET /api/imports/:id answers it, in `status`, with `receivedBytes` stored. */
function viewOf(status: ImportView["status"], receivedBytes: number, declaredBytes: number): ImportView {
  return ImportView.parse({
    id: ID,
    source: "mastodon",
    status,
    createdAt: "2026-10-27T10:00:00.000Z",
    endedAt: null,
    declaredBytes,
    receivedBytes,
    chunkBytes: IMPORT_RULES.chunkBytes,
    failure: null,
    stopReason: null,
    endedByStaff: null,
    staffDecisionId: null,
    scan: null,
    samples: [],
    choice: null,
    picks: [],
    progress: { imagesTotal: 0, imagesSettled: 0, postsTotal: 0, postsPublished: 0, postsRemoved: 0, postsLeft: 0, imagesLeftOut: {} },
    paused: false,
    refusalId: null,
    refusedAt: null,
    refusedWords: null,
    undoable: false,
  });
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refusal = (status: number, code: string, details?: unknown) => json(status, { error: { code, message: code, ...(details === undefined ? {} : { details }) } });
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** One request the fake API saw: a chunk's offset, length and hash, or a read of the import. */
type Seen = { kind: "put"; offset: number; length: number; sha256: string; type: string | null } | { kind: "get" };

/**
 * The API's chunk route in a fake fetch: the stored archive, refusals planned by offset (chunk_mismatch, a lost answer, a
 * lost request), and GET /api/imports/:id, which answers the stored size.
 */
function fakeApi(declared: number, plan: { mismatch?: Record<number, number>; lostAnswer?: number[]; lostRequest?: number[]; stored?: number; status?: ImportView["status"]; refuse?: Record<number, string> } = {}) {
  const stored = { bytes: new Uint8Array(declared), size: plan.stored ?? 0 };
  const seen: Seen[] = [];
  const mismatch = { ...(plan.mismatch ?? {}) };
  const lostAnswer = new Set(plan.lostAnswer ?? []);
  const lostRequest = new Set(plan.lostRequest ?? []);
  const fetch = vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: Blob }) => {
    if (init.method === "GET" && url === `/api/imports/${ID}`) {
      seen.push({ kind: "get" });
      return json(200, viewOf(plan.status ?? "uploading", stored.size, declared));
    }
    if (init.method !== "PUT" || url !== `/api/imports/${ID}/archive`) return refusal(404, "not_found");
    const offset = Number(init.headers["import-offset"]);
    const body = new Uint8Array(await init.body!.arrayBuffer());
    const hash = init.headers["import-chunk-sha256"]!;
    seen.push({ kind: "put", offset, length: body.length, sha256: hash, type: init.headers["content-type"] ?? null });
    if (lostRequest.has(offset)) {
      lostRequest.delete(offset);
      throw new TypeError("Failed to fetch");
    }
    if (plan.refuse?.[offset]) return refusal(400, plan.refuse[offset]!);
    if (offset !== stored.size) return refusal(409, "wrong_offset", { receivedBytes: stored.size });
    if ((mismatch[offset] ?? 0) > 0) {
      mismatch[offset]! -= 1;
      return refusal(400, "chunk_mismatch");
    }
    if (sha(body) !== hash) return refusal(400, "chunk_mismatch");
    stored.bytes.set(body, offset);
    stored.size = offset + body.length;
    if (lostAnswer.has(offset)) {
      lostAnswer.delete(offset);
      throw new TypeError("Failed to fetch");
    }
    return json(200, { receivedBytes: stored.size });
  });
  vi.stubGlobal("fetch", fetch);
  return { stored, seen, puts: () => seen.filter((entry) => entry.kind === "put") as Extract<Seen, { kind: "put" }>[] };
}

/** An archive of `size` bytes whose every byte depends on its place, starting with a zip's local header. */
function archive(size: number): { file: Blob; bytes: Uint8Array } {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
  bytes.set([0x50, 0x4b, 0x03, 0x04], 0);
  return { file: new Blob([bytes]), bytes };
}

const noWait = async () => undefined;

afterEach(() => vi.unstubAllGlobals());

describe("the chunked uploader (7.3, 10.3)", () => {
  test("sends the archive one chunk at a time, exactly chunkBytes but the last, each at its offset with its SHA-256 as 64 lowercase hex", async () => {
    const { file, bytes } = archive(2500);
    const api = fakeApi(2500);
    const progress: number[] = [];
    const outcome = await uploadArchive({ id: ID, file, from: 0, chunkBytes: 1000, onProgress: (received) => progress.push(received), wait: noWait });
    expect(outcome).toEqual({ status: "done", receivedBytes: 2500 });
    expect(api.puts().map(({ offset, length }) => [offset, length])).toEqual([
      [0, 1000],
      [1000, 1000],
      [2000, 500],
    ]);
    for (const put of api.puts()) {
      expect(put.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(put.sha256).toBe(sha(bytes.subarray(put.offset, put.offset + put.length)));
      expect(put.type).toBe("application/octet-stream");
    }
    expect(progress).toEqual([1000, 2000, 2500]);
    expect(api.stored.bytes).toEqual(bytes);
  });

  test("with the real chunk size, a 20 MB archive is three chunks of 8 MiB, 8 MiB and the rest", async () => {
    const { file } = archive(20_000_000);
    const api = fakeApi(20_000_000);
    const outcome = await uploadArchive({ id: ID, file, from: 0, chunkBytes: IMPORT_RULES.chunkBytes, wait: noWait });
    expect(outcome.status).toBe("done");
    expect(api.puts().map(({ offset, length }) => [offset, length])).toEqual([
      [0, IMPORT_RULES.chunkBytes],
      [IMPORT_RULES.chunkBytes, IMPORT_RULES.chunkBytes],
      [2 * IMPORT_RULES.chunkBytes, 20_000_000 - 2 * IMPORT_RULES.chunkBytes],
    ]);
  }, 30_000);

  test("goes on from receivedBytes: a resumed upload sends only what the API does not hold yet", async () => {
    const { file } = archive(2500);
    const api = fakeApi(2500, { stored: 2000 });
    expect(await uploadArchive({ id: ID, file, from: 2000, chunkBytes: 1000, wait: noWait })).toEqual({ status: "done", receivedBytes: 2500 });
    expect(api.puts().map(({ offset }) => offset)).toEqual([2000]);
  });

  test("a chunk the API answers chunk_mismatch is sent again, at most chunkRetries times", async () => {
    const { file } = archive(2500);
    const api = fakeApi(2500, { mismatch: { 1000: IMPORT_RULES.chunkRetries } });
    expect((await uploadArchive({ id: ID, file, from: 0, chunkBytes: 1000, wait: noWait })).status).toBe("done");
    expect(api.puts().map(({ offset }) => offset)).toEqual([0, 1000, 1000, 1000, 1000, 2000]);

    const again = fakeApi(2500, { mismatch: { 1000: IMPORT_RULES.chunkRetries + 1 } });
    const outcome = await uploadArchive({ id: ID, file, from: 0, chunkBytes: 1000, wait: noWait });
    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.error.code).toBe("chunk_mismatch");
    expect(outcome.status === "failed" && outcome.receivedBytes).toBe(1000);
    // The first try and chunkRetries more, then nothing.
    expect(again.puts().map(({ offset }) => offset)).toEqual([0, 1000, 1000, 1000, 1000]);
  });

  test("wrong_offset moves the upload to the stored size the answer carries", async () => {
    const { file } = archive(2500);
    const api = fakeApi(2500, { stored: 2000 });
    expect((await uploadArchive({ id: ID, file, from: 1000, chunkBytes: 1000, wait: noWait })).status).toBe("done");
    expect(api.puts().map(({ offset }) => offset)).toEqual([1000, 2000]);
  });

  test("after a network error it reads the import before it sends more, and goes on from that import's receivedBytes", async () => {
    const { file, bytes } = archive(2500);
    // The second chunk arrived but its answer was lost; the third request was lost on its way.
    const api = fakeApi(2500, { lostAnswer: [1000], lostRequest: [2000] });
    expect(await uploadArchive({ id: ID, file, from: 0, chunkBytes: 1000, wait: noWait })).toEqual({ status: "done", receivedBytes: 2500 });
    expect(api.seen.map((entry) => (entry.kind === "get" ? "get" : entry.offset))).toEqual([0, 1000, "get", 2000, "get", 2000]);
    expect(api.stored.bytes).toEqual(bytes);
  });

  test("an import that left uploading meanwhile ends the upload with its view; any other refusal ends it with its error", async () => {
    const { file } = archive(2500);
    fakeApi(2500, { lostAnswer: [0], status: "cancelled" });
    const moved = await uploadArchive({ id: ID, file, from: 0, chunkBytes: 1000, wait: noWait });
    expect(moved.status).toBe("moved");
    expect(moved.status === "moved" && moved.view.status).toBe("cancelled");

    const api = fakeApi(2500, { refuse: { 0: "not_an_archive" } });
    const refused = await uploadArchive({ id: ID, file, from: 0, chunkBytes: 1000, wait: noWait });
    expect(refused.status === "failed" && refused.error.code).toBe("not_an_archive");
    expect(api.puts()).toHaveLength(1);
  });

  test("stops before the next chunk once the person cancelled", async () => {
    const { file } = archive(2500);
    const api = fakeApi(2500);
    let sent = 0;
    const outcome = await uploadArchive({ id: ID, file, from: 0, chunkBytes: 1000, onProgress: () => (sent += 1), stopped: () => sent >= 1, wait: noWait });
    expect(outcome).toEqual({ status: "stopped", receivedBytes: 1000 });
    expect(api.puts()).toHaveLength(1);
  });

  test("chunkHash is the chunk's SHA-256 through crypto.subtle, in lowercase hex", async () => {
    const bytes = new TextEncoder().encode("korbat");
    expect(await chunkHash(bytes.buffer)).toBe(sha(bytes));
  });

  test("the client's calls: PUT with Import-Offset and Import-Chunk-Sha256, the routes of 9.2, and the statement with the choice", async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => {
        calls.push({ url, method: init.method, headers: init.headers, body: init.body });
        if (url.endsWith("/archive")) return json(200, { receivedBytes: 4 });
        if (url.includes("/lines?")) return json(200, { lines: [], pages: 0 });
        if (url.includes("/lines/")) return json(200, { ref: 3, leftOut: true, alts: [], picks: [] });
        if (url === "/api/imports" && init.method === "GET") return json(200, { imports: [], sources: ["x", "mastodon"] });
        return json(200, viewOf("ready", 4, 4));
      }),
    );
    await imports.chunk(ID, 8, new Blob([new Uint8Array(4)]), "a".repeat(64));
    expect(calls[0]).toMatchObject({ url: `/api/imports/${ID}/archive`, method: "PUT", headers: { "import-offset": "8", "import-chunk-sha256": "a".repeat(64), "content-type": "application/octet-stream" } });
    expect(await imports.list()).toEqual({ imports: [], sources: ["x", "mastodon"] });
    await imports.lines(ID, 2);
    expect(calls.at(-1)).toMatchObject({ url: `/api/imports/${ID}/lines?page=2`, method: "GET" });
    await imports.pick(ID, 3, { leftOut: true, alts: [] });
    expect(calls.at(-1)).toMatchObject({ url: `/api/imports/${ID}/lines/3`, method: "PUT", body: JSON.stringify({ leftOut: true, alts: [] }) });
    const choice: ImportChoice = { from: null, to: null, replies: false, warnings: false, protected: false, images: false, long: "leave" };
    await imports.confirm(ID, choice);
    expect(calls.at(-1)).toMatchObject({ url: `/api/imports/${ID}/confirm`, method: "POST", body: JSON.stringify({ choice, statement: true }) });
    for (const action of ["cancel", "stop", "undo"] as const) {
      await imports[action](ID);
      expect(calls.at(-1)).toMatchObject({ url: `/api/imports/${ID}/${action}`, method: "POST" });
    }
    await imports.create("x", 1234);
    expect(calls.at(-1)).toMatchObject({ url: "/api/imports", method: "POST", body: JSON.stringify({ source: "x", bytes: 1234 }) });
    expect(imports.mediaUri(ID, "3-0.jpg")).toBe(`/api/imports/${ID}/media/3-0.jpg`);
  });
});

describe("the archive's first bytes, before anything is sent (4.2 step 2)", () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  const gzip = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
  // A CAR: the header's length as a varint (58), then a CBOR map of two members.
  const car = new Uint8Array([0x3a, 0xa2, 0x65, 0x72, 0x6f, 0x6f, 0x74, 0x73]);

  test("a zip for X and Mastodon, a CAR for Bluesky; gzip is the old Mastodon archive; anything else is not this source's", () => {
    expect(archiveProblem("x", 1000, zip)).toBeNull();
    expect(archiveProblem("mastodon", 1000, zip)).toBeNull();
    expect(archiveProblem("bluesky", 1000, car)).toBeNull();
    expect(archiveProblem("mastodon", 1000, gzip)).toBe("import.tarGz");
    expect(archiveProblem("x", 1000, gzip)).toBe("import.tarGz");
    expect(archiveProblem("bluesky", 1000, zip)).toBe("import.notArchive");
    expect(archiveProblem("x", 1000, car)).toBe("import.notArchive");
    expect(archiveProblem("x", 0, new Uint8Array())).toBe("import.notArchive");
  });

  test("an archive over 2 GiB is refused by its size first", () => {
    expect(archiveProblem("x", IMPORT_RULES.maxBytes, zip)).toBeNull();
    expect(archiveProblem("x", IMPORT_RULES.maxBytes + 1, zip)).toBe("import.tooLarge");
  });
});

describe("the choice's totals, as the API counts them (the orchestrator's ruling for Task 5)", () => {
  const CHOICE: ImportChoice = { from: null, to: null, replies: false, warnings: false, protected: false, images: true, long: "leave" };
  // apps/api/test/imports-plan.test.ts's table: March, 3 posts without marks with 4 images (1 undescribed) and 2 replies
  // with 2 images; May, 1 post with 1 image.
  const scan = {
    months: [
      { month: "2019-03", groups: [[0, 3, 4, 1], [1, 2, 2, 0]] as [number, number, number, number][] },
      { month: "2019-05", groups: [[0, 1, 1, 0]] as [number, number, number, number][] },
    ],
  };
  // Its picks as the view counts them ([marks, posts left out, their described images, descriptions given]): a post of
  // March left out with 2 described images, a post of March given one description, a reply left out with 1.
  const picks = [{ month: "2019-03", groups: [[0, 1, 2, 1], [1, 1, 1, 0]] as [number, number, number, number][] }];

  test("the same answers as the API's chosenTotals for the same table", () => {
    expect(chosenTotals({ scan, picks: [] }, CHOICE, true)).toEqual({ posts: 4, images: 4 });
    expect(chosenTotals({ scan, picks: [] }, { ...CHOICE, replies: true }, true)).toEqual({ posts: 6, images: 6 });
    expect(chosenTotals({ scan, picks: [] }, { ...CHOICE, from: "2019-04" }, true)).toEqual({ posts: 1, images: 1 });
    expect(chosenTotals({ scan, picks }, CHOICE, true)).toEqual({ posts: 3, images: 3 });
    expect(chosenTotals({ scan, picks }, CHOICE, false)).toEqual({ posts: 3, images: 0 });
    expect(chosenTotals({ scan, picks: [] }, { ...CHOICE, from: "2019-04", to: "2019-04" }, true)).toEqual({ posts: 0, images: 0 });
  });

  test("the reasons the app counts: replies, long posts, warnings and protected posts the choice leaves out, and the posts left out by hand", () => {
    expect(leftOutCounts({ scan, picks }, CHOICE)).toEqual({ reply: 2, left_out: 1 });
    expect(leftOutCounts({ scan, picks }, { ...CHOICE, replies: true })).toEqual({ left_out: 2 });
    const marked = { months: [{ month: "2019-03", groups: [[2, 4, 0, 0], [3, 1, 0, 0], [4, 2, 0, 0], [8, 3, 0, 0]] as [number, number, number, number][] }] };
    // A line with several marks is counted once, by the first mark the choice refuses.
    expect(leftOutCounts({ scan: marked, picks: [] }, CHOICE)).toEqual({ too_long: 4, reply: 1, warning: 2, protected: 3 });
    expect(leftOutCounts({ scan: marked, picks: [] }, { ...CHOICE, long: "shorten", warnings: true, protected: true })).toEqual({ reply: 1 });
  });

  test("marksPass and monthInChoice as plan.ts has them: either end of a range may be open", () => {
    expect(marksPass(0, CHOICE)).toBe(true);
    expect(marksPass(1, CHOICE)).toBe(false);
    expect(marksPass(2, { ...CHOICE, long: "shorten" })).toBe(true);
    expect(monthInChoice("2019-03", { from: null, to: "2019-03" })).toBe(true);
    expect(monthInChoice("2019-03", { from: "2019-04", to: null })).toBe(false);
  });
});

describe("numbers, sizes, refusals and announcements", () => {
  test("counts with a thousands separator, sizes in decimal megabytes as the value text prints them", () => {
    expect(formatCount(1240)).toBe("1,240");
    expect(formatBytes(120_000_000)).toBe("120 MB");
    expect(formatBytes(840_000_000)).toBe("840 MB");
    expect(formatBytes(2_500_000)).toBe("2.5 MB");
    expect(formatBytes(4_000)).toBe("4 KB");
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(1_500_000_000)).toBe("1.5 GB");
  });

  test("the refusals of 9.4 in the words of 10.9: each code its sentence, the weekly and the network limit apart", () => {
    const words = (code: string, status = 400) => importErrorMessage(new ApiError(status, code, "the server's"), { during: "create" });
    expect(words("import_active", 409)).toBe(IMPORT_WORDS["import.active"]);
    expect(words("imports_unavailable", 503)).toBe(IMPORT_WORDS["import.unavailable"]);
    expect(words("import_weekly_limit", 429)).toBe(IMPORT_WORDS["import.limit"]);
    expect(words("rate_limited", 429)).toBe(IMPORT_WORDS["import.limit.network"]);
    expect(words("import_too_soon", 403)).toBe(IMPORT_WORDS["import.tooSoon"]);
    expect(words("archive_too_large", 413)).toBe(IMPORT_WORDS["import.tooLarge"]);
    expect(words("wrong_state", 409)).toBe(IMPORT_WORDS["import.wrongState"]);
    expect(words("statement_required")).toBe(IMPORT_WORDS["import.statementRequired"]);
    expect(words("nothing_chosen")).toBe(IMPORT_WORDS["import.publish.nothing"]);
    // The shared codes keep the server's or the app's shared sentence; rate_limited is the network's limit only on a create.
    expect(words("account_suspended", 403)).toBe("the server's");
    expect(importErrorMessage(new ApiError(429, "rate_limited", "the server's"), { during: "act" })).toBe("the server's");
    expect(importErrorMessage(new ApiError(400, "not_an_archive", "the server's"), { source: "x" })).toBe(fill(IMPORT_WORDS["import.notArchive"], { source: "X" }));
  });

  test("a change of state while the screen is open is said in one polite sentence; a change that is no news says nothing", () => {
    expect(announcement("scanning", "ready")).toBe(IMPORT_WORDS["import.now.ready"]);
    expect(announcement("scanning", "failed")).toBe(IMPORT_WORDS["import.now.failed"]);
    expect(announcement("uploading", "failed")).toBe(IMPORT_WORDS["import.now.failed"]);
    expect(announcement("publishing", "done")).toBe(IMPORT_WORDS["import.now.done"]);
    expect(announcement("uploading", "scanning")).toBe(IMPORT_WORDS["import.now.scanning"]);
    expect(announcement("preparing", "publishing")).toBe(IMPORT_WORDS["import.now.publishing"]);
    expect(announcement("publishing", "stopped")).toBe(IMPORT_WORDS["import.now.stopped"]);
    expect(announcement("undoing", "undone")).toBe(IMPORT_WORDS["import.now.undone"]);
    expect(announcement("ready", "ready")).toBeNull();
    // The person's own press is answered where they pressed it: their confirm, cancel, stop and remove say nothing more here.
    expect(announcement("ready", "publishing")).toBeNull();
  });
});
