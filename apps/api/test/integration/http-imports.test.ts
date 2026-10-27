import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { ErrorEnvelope, IMPORT_RULES, ImportView } from "@korbat/contracts";
import { randomIp, type Browser } from "./http-client";
import { importsHarness, sha256, zipArchive, type ImportsHarness } from "./imports-harness";
import { suspendRowForTest } from "./moderation-fixtures";

// Each test signs accounts up over HTTP and one sends an archive of more than 8 MiB: slow on a loaded machine.
vi.setConfig({ testTimeout: 120_000 });

/**
 * The imports routes over HTTP (3b design, sections 4.2, 7.3, 9.2 and 9.4; 12.3): the creation and each of its refusals
 * in 4.2's order, the chunks through the app with their sizes and a resume, the cancel, the list, someone else's import,
 * and every refusal answered with its status, never 500.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: imports over HTTP", () => {
  let h: ImportsHarness;
  beforeAll(async () => {
    h = await importsHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const refusal = async (res: Response) => [res.status, ErrorEnvelope.parse(await res.json()).error.code];
  /** The uploads and scans on the site now, which the site's cap counts. */
  const siteActive = async () => (await h.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from import_jobs where status in ('uploading', 'scanning')`))[0]!.n;

  test("a creation is an import in uploading of the declared size, with the chunk size, of the account alone; the account's key is made once", async () => {
    const { b, id } = await h.signUp();
    const res = await h.create(b, { source: "x", bytes: 1234 });
    expect(res.status).toBe(201);
    const view = ImportView.parse(await res.json());
    expect(view).toMatchObject({ source: "x", status: "uploading", declaredBytes: 1234, receivedBytes: 0, chunkBytes: IMPORT_RULES.chunkBytes, failure: null, scan: null, samples: [], picks: [], undoable: false, paused: false });
    expect((await h.row(view.id))?.images).toBe(false);
    expect(existsSync(h.archives.jobDir(view.id))).toBe(true);
    const [key] = await h.migrateDb.execute<{ n: number; bytes: number }>(sql`select count(*)::int as n, max(octet_length(key))::int as bytes from import_keys where owner_id = ${id}::uuid`);
    expect({ ...key }).toEqual({ n: 1, bytes: IMPORT_RULES.keyBytes });
    // Someone else's import is no import at all.
    const other = await h.signUp();
    expect(await refusal(await other.b.fetch(`/api/imports/${view.id}`))).toEqual([404, "not_found"]);
    expect(await refusal(await h.chunk(other.b, view.id, 0, zipArchive(1234)))).toEqual([404, "not_found"]);
    expect(await refusal(await other.b.fetch(`/api/imports/${view.id}/cancel`, { method: "POST" }))).toEqual([404, "not_found"]);
    expect(await refusal(await b.fetch("/api/imports/not-an-import"))).toEqual([404, "not_found"]);
    // A second creation while it is active.
    expect(await refusal(await h.create(b))).toEqual([409, "import_active"]);
    // Cancelled, the account may start again, and its key stays the one it had.
    expect((await b.fetch(`/api/imports/${view.id}/cancel`, { method: "POST" })).status).toBe(200);
    const again = await h.created(b);
    const [still] = await h.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from import_keys where owner_id = ${id}::uuid`);
    expect(still!.n).toBe(1);
    expect((await b.fetch(`/api/imports/${again.id}/cancel`, { method: "POST" })).status).toBe(200);
  });

  test("the refusals of a creation, in 4.2's order: the size first, then the switches, the suspension, the account's age, and a body that is no request", async () => {
    const young = await h.signUp({ ageDays: 6 });
    // 2 GiB and one byte: archive_too_large before anything else is looked at, even for an account too young.
    expect(await refusal(await h.create(young.b, { source: "mastodon", bytes: IMPORT_RULES.maxBytes + 1 }))).toEqual([413, "archive_too_large"]);
    expect(await refusal(await h.create(young.b, { source: "mastodon", bytes: 0 }))).toEqual([400, "invalid_request"]);
    expect(await refusal(await h.create(young.b, { source: "threads", bytes: 10 }))).toEqual([400, "invalid_request"]);
    // A source switched off, and imports switched off, answer as the site's: before the account is read.
    h.settings.sources = ["x"];
    expect(await refusal(await h.create(young.b, { source: "mastodon", bytes: 10 }))).toEqual([503, "imports_unavailable"]);
    h.settings.sources = ["x", "mastodon"];
    h.settings.imports = false;
    expect(await refusal(await h.create(young.b, { source: "x", bytes: 10 }))).toEqual([503, "imports_unavailable"]);
    h.settings.imports = true;
    // Six days old: too soon. Suspended as well: the suspension answers first.
    expect(await refusal(await h.create(young.b))).toEqual([403, "import_too_soon"]);
    await suspendRowForTest(h.migrateDb, young.id);
    expect(await refusal(await h.create(young.b))).toEqual([403, "account_suspended"]);
    // At seven days it would be taken, but for the suspension.
    await h.age(young.id, 7);
    expect(await refusal(await h.create(young.b))).toEqual([403, "account_suspended"]);
    const [rows] = await h.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from import_jobs where owner_id = ${young.id}::uuid`);
    expect(rows!.n).toBe(0);
  });

  test("three published imports in seven days refuse a fourth with import_weekly_limit and Retry-After; failed, cancelled and unpublished ones cost nothing", async () => {
    const { b, id } = await h.signUp({ ageDays: 40 });
    // Rows written as the migrator, whose insert import_jobs_insert leaves as it is: past imports in their end states.
    const job = (status: string, confirmed: string | null, published: number, ends: { failure?: string; stop?: string } = {}) =>
      h.migrateDb.execute(sql`insert into import_jobs (id, owner_id, source, declared_bytes, status, confirmed_at, posts_published, ended_at, failure, stop_reason)
                              values (${randomUUID()}::uuid, ${id}::uuid, 'mastodon', 100, ${status}::import_status, ${confirmed === null ? null : sql`now() - ${confirmed}::interval`},
                                      ${published}, now(), ${ends.failure ?? null}, ${ends.stop ?? null})`);
    await job("done", "1 day", 10);
    await job("stopped", "2 days", 5, { stop: "by_author" });
    // These cost nothing: a failed scan, a cancel, an import done with nothing published, one published eight days ago.
    await job("failed", null, 0, { failure: "unreadable" });
    await job("cancelled", null, 0);
    await job("done", "1 day", 0);
    await job("done", "8 days", 50);
    const third = await h.created(b);
    expect((await b.fetch(`/api/imports/${third.id}/cancel`, { method: "POST" })).status).toBe(200);
    await job("undone", "3 days", 7);
    const res = await h.create(b);
    expect(await refusal(res)).toEqual([429, "import_weekly_limit"]);
    // The oldest of the three leaves the window in four days.
    const wait = Number(res.headers.get("retry-after"));
    expect(wait).toBeGreaterThan(4 * 86_400 - 120);
    expect(wait).toBeLessThanOrEqual(4 * 86_400);
  });

  test("five imports a day from one address: the sixth is rate_limited, and a creation refused for another reason costs the address nothing", async () => {
    const ip = randomIp();
    const tooYoung = await h.signUp({ ip, ageDays: 3 });
    for (let i = 0; i < 3; i++) expect(await refusal(await h.create(tooYoung.b))).toEqual([403, "import_too_soon"]);
    const views: { b: Browser; id: string }[] = [];
    h.settings.maxActive = 100;
    for (let i = 0; i < IMPORT_RULES.importsPerAddressDay; i++) {
      const { b } = await h.signUp({ ip });
      views.push({ b, id: (await h.created(b)).id });
    }
    const sixth = await h.signUp({ ip });
    const res = await h.create(sixth.b);
    expect(await refusal(res)).toEqual([429, "rate_limited"]);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another address is not counted with this one.
    const elsewhere = await h.signUp();
    const taken = await h.created(elsewhere.b);
    for (const view of [...views, { b: elsewhere.b, id: taken.id }]) expect((await view.b.fetch(`/api/imports/${view.id}/cancel`, { method: "POST" })).status).toBe(200);
    h.settings.maxActive = IMPORT_RULES.maxActiveDefault;
  });

  test("the site's uploads and scans are capped under a lock: of two creations at once by two accounts at the cap, one is refused", async () => {
    const ada = await h.signUp();
    const bob = await h.signUp();
    h.settings.maxActive = (await siteActive()) + 1;
    try {
      const answers = await Promise.all([h.create(ada.b), h.create(bob.b)]);
      expect(answers.map((res) => res.status).sort()).toEqual([201, 503]);
      const refused = answers.find((res) => res.status === 503)!;
      expect(ErrorEnvelope.parse(await refused.json()).error.code).toBe("imports_unavailable");
      const taken = ImportView.parse(await answers.find((res) => res.status === 201)!.json());
      const owner = answers[0]!.status === 201 ? ada : bob;
      expect((await owner.b.fetch(`/api/imports/${taken.id}/cancel`, { method: "POST" })).status).toBe(200);
    } finally {
      h.settings.maxActive = IMPORT_RULES.maxActiveDefault;
    }
  });

  test("the importer's heartbeat older than 60 seconds, or free space under the archive, the 4 GiB of its scan and the floor, refuse with imports_unavailable", async () => {
    const { b } = await h.signUp();
    h.beat(Date.now() - 61_000);
    expect(await refusal(await h.create(b))).toEqual([503, "imports_unavailable"]);
    h.beat();
    const need = 100 + IMPORT_RULES.scanWriteBytes + h.settings.minFreeBytes;
    h.setFree(need - 1);
    expect(await refusal(await h.create(b, { source: "mastodon", bytes: 100 }))).toEqual([503, "imports_unavailable"]);
    h.setFree(need);
    const view = await h.created(b, { source: "mastodon", bytes: 100 });
    h.setFree(64 * 1024 ** 3);
    expect((await b.fetch(`/api/imports/${view.id}/cancel`, { method: "POST" })).status).toBe(200);
  });

  test("chunks over HTTP: 8 MiB at the stored offset, a refused chunk resumed from the stored size, sizes over the rules refused; the last completes the archive", async () => {
    const { b } = await h.signUp();
    const archive = zipArchive(IMPORT_RULES.chunkBytes + 1000);
    const view = await h.created(b, { source: "mastodon", bytes: archive.length });
    const first = archive.subarray(0, IMPORT_RULES.chunkBytes);
    const last = archive.subarray(IMPORT_RULES.chunkBytes);
    // A first chunk shorter than 8 MiB that does not end the archive, and a body over the chunk's size, are refused.
    expect(await refusal(await h.chunk(b, view.id, 0, first.subarray(0, 1000)))).toEqual([413, "chunk_too_large"]);
    expect(await refusal(await h.chunk(b, view.id, 0, zipArchive(IMPORT_RULES.chunkBytes + 1)))).toEqual([413, "chunk_too_large"]);
    expect(await (await h.chunk(b, view.id, 0, first)).json()).toEqual({ receivedBytes: IMPORT_RULES.chunkBytes });
    // The same chunk again: the stored size tells the app where to go on.
    const wrong = await h.chunk(b, view.id, 0, first);
    expect(wrong.status).toBe(409);
    expect(ErrorEnvelope.parse(await wrong.json()).error).toMatchObject({ code: "wrong_offset", details: { receivedBytes: IMPORT_RULES.chunkBytes } });
    // A damaged last chunk is refused and leaves the file at 8 MiB; the app reads the import and sends it again.
    expect(await refusal(await h.chunk(b, view.id, IMPORT_RULES.chunkBytes, last, { "import-chunk-sha256": sha256(first) }))).toEqual([400, "chunk_mismatch"]);
    const resumed = ImportView.parse(await (await b.fetch(`/api/imports/${view.id}`)).json());
    expect([resumed.status, resumed.receivedBytes]).toEqual(["uploading", IMPORT_RULES.chunkBytes]);
    expect(await (await h.chunk(b, view.id, resumed.receivedBytes, last)).json()).toEqual({ receivedBytes: archive.length });
    const done = ImportView.parse(await (await b.fetch(`/api/imports/${view.id}`)).json());
    expect([done.status, done.receivedBytes]).toEqual(["scanning", archive.length]);
    const row = await h.row(view.id);
    expect(row?.uploaded_at).not.toBeNull();
    expect(existsSync(h.archives.archive(view.id)) && existsSync(h.archives.job(view.id)) && existsSync(h.archives.queued(view.id))).toBe(true);
    expect(existsSync(h.archives.part(view.id))).toBe(false);
    // No chunk is taken once the archive is complete; the JSON routes keep their 64 KiB.
    expect(await refusal(await h.chunk(b, view.id, archive.length, last))).toEqual([409, "wrong_state"]);
    expect(await refusal(await b.fetch("/api/imports", { json: { source: "mastodon", bytes: 10, pad: "x".repeat(70_000) } }))).toEqual([413, "payload_too_large"]);
    // A cancel while it waits for its scan takes the archive and its marker, and asks the importer to drop its work.
    const cancelled = ImportView.parse(await (await b.fetch(`/api/imports/${view.id}/cancel`, { method: "POST" })).json());
    expect([cancelled.status, cancelled.endedAt !== null]).toEqual(["cancelled", true]);
    expect((await h.row(view.id))?.scanned_at).not.toBeNull();
    expect(existsSync(h.archives.jobDir(view.id)) || existsSync(h.archives.queued(view.id))).toBe(false);
    expect(existsSync(h.archives.deletion(view.id))).toBe(true);
    expect(await refusal(await b.fetch(`/api/imports/${view.id}/cancel`, { method: "POST" }))).toEqual([409, "wrong_state"]);
  });

  test("a first chunk that is not an archive of the source fails the import: gzip as tar_gz, anything else as not_an_archive", async () => {
    const { b, id } = await h.signUp();
    const tar = new Uint8Array(64);
    tar.set([0x1f, 0x8b, 8, 0]);
    const view = await h.created(b, { source: "mastodon", bytes: 64 });
    expect(await refusal(await h.chunk(b, view.id, 0, tar))).toEqual([400, "not_an_archive"]);
    expect(await h.row(view.id)).toMatchObject({ status: "failed", failure: "tar_gz" });
    const plain = await h.created(b, { source: "x", bytes: 64 });
    expect(await refusal(await h.chunk(b, plain.id, 0, new Uint8Array(64).fill(65)))).toEqual([400, "not_an_archive"]);
    const failed = ImportView.parse(await (await b.fetch(`/api/imports/${plain.id}`)).json());
    expect([failed.status, failed.failure, failed.endedAt !== null]).toEqual(["failed", "not_an_archive", true]);
    expect(existsSync(h.archives.jobDir(plain.id))).toBe(false);
    const [rows] = await h.migrateDb.execute<{ n: number }>(sql`select count(*)::int as n from import_jobs where owner_id = ${id}::uuid and status = 'failed'`);
    expect(rows!.n).toBe(2);
  });

  test("the list: the account's imports newest first, at most 20, and the sources a new import may name", async () => {
    const { b, id } = await h.signUp();
    for (let i = 0; i < 21; i++) {
      await h.migrateDb.execute(sql`insert into import_jobs (id, owner_id, source, declared_bytes, status, ended_at, created_at)
                                     values (${randomUUID()}::uuid, ${id}::uuid, 'x', 100, 'cancelled', now(), now() - make_interval(mins => ${i + 1}))`);
    }
    const newest = await h.created(b);
    const list = (await (await b.fetch("/api/imports")).json()) as { imports: unknown[]; sources: string[] };
    const imports = list.imports.map((item) => ImportView.parse(item));
    expect(imports).toHaveLength(IMPORT_RULES.listMax);
    expect(imports[0]!.id).toBe(newest.id);
    expect(imports.slice(1).every((item) => item.status === "cancelled")).toBe(true);
    expect(list.sources).toEqual(["x", "mastodon"]);
    h.settings.imports = false;
    expect(((await (await b.fetch("/api/imports")).json()) as { sources: string[] }).sources).toEqual([]);
    h.settings.imports = true;
    const other = await h.signUp();
    expect(((await (await other.b.fetch("/api/imports")).json()) as { imports: unknown[] }).imports).toEqual([]);
    expect((await b.fetch(`/api/imports/${newest.id}/cancel`, { method: "POST" })).status).toBe(200);
  });

  test("the routes need a session and, for a cookie session, the CSRF header", async () => {
    const { b } = await h.signUp();
    const view = await h.created(b);
    expect((await h.app.request("/api/imports")).status).toBe(401);
    const res = await b.fetch(`/api/imports/${view.id}/cancel`, { method: "POST", csrf: false });
    expect(res.status).toBe(403);
    expect((await b.fetch(`/api/imports/${view.id}/cancel`, { method: "POST" })).status).toBe(200);
  });

  test("an account's cancels are counted: the 21st in an hour is rate_limited (import-act)", async () => {
    const { b } = await h.signUp();
    const nobody = randomUUID();
    for (let i = 0; i < IMPORT_RULES.actsPerHour; i++) expect(await refusal(await b.fetch(`/api/imports/${nobody}/cancel`, { method: "POST" }))).toEqual([404, "not_found"]);
    const res = await b.fetch(`/api/imports/${nobody}/cancel`, { method: "POST" });
    expect(await refusal(res)).toEqual([429, "rate_limited"]);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  test("this file left no import row behind", async () => {
    const { now, before } = await h.cleanup();
    expect(now).toEqual(before);
  });
});

