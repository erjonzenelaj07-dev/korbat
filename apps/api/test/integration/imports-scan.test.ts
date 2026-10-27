import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { IMPORT_RULES, ImportScanFacts, ImportView } from "@korbat/contracts";
import { writeScanOutput } from "@korbat/import-protocol";
import { importsHarness, line, scanned, zipArchive, type ImportsHarness } from "./imports-harness";

vi.setConfig({ testTimeout: 120_000 });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * import-drive's steps of Task 4 (3b design, sections 4.3, 4.8 and 7.5; 12.3), with writeScanOutput standing in for the
 * importer: the archive deleted once the summary is read, the intake and the move to ready, a failed scan, a summary the
 * API cannot take, the 45-minute and 24-hour bounds of a scan, the expiry of an upload and of a preview, the 72-hour
 * stop, the retention of picks and rows, and the orphans a crash leaves.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: import-drive", () => {
  let h: ImportsHarness;
  beforeAll(async () => {
    // Several of this file's imports wait in scanning at once; the site's cap is http-imports.test.ts's to try.
    h = await importsHarness({ settings: { maxActive: 100 } });
  });
  afterAll(async () => {
    await h?.close();
  });

  /** A new account's import with its archive uploaded, waiting for its scan. */
  async function uploaded(options: { ageDays?: number } = {}) {
    const account = await h.signUp(options);
    const archive = zipArchive(100);
    const view = await h.created(account.b, { source: "mastodon", bytes: archive.length });
    await h.upload(account.b, view.id, archive);
    return { b: account.b, ownerId: account.id, id: view.id };
  }
  const viewOf = async (b: Awaited<ReturnType<typeof uploaded>>["b"], id: string) => ImportView.parse(await (await b.fetch(`/api/imports/${id}`)).json());
  const drive = (at = new Date()) => h.imports.drive(at, { orphans: false });

  test("a scanned summary: the archive and its marker go at once, the intake's numbers are stored, and the import is ready with its samples", async () => {
    const { b, id } = await uploaded();
    expect(existsSync(h.archives.archive(id)) && existsSync(h.archives.queued(id))).toBe(true);
    // No summary yet: the importer has not finished, and nothing moves.
    await drive();
    expect((await viewOf(b, id)).status).toBe("scanning");
    const posts = [line(0), line(1, { kind: "reply" }), line(2), line(3, { at: "2019-04-02T08:00:00Z" })];
    writeScanOutput(h.work.root, posts, scanned(id, 4, { skipped: { not_public: 9, repost: 2 }, warnings: 0 }));
    const report = await drive();
    expect(report.ready).toBe(1);
    expect(existsSync(h.archives.jobDir(id)) || existsSync(h.archives.queued(id))).toBe(false);
    const view = await viewOf(b, id);
    expect(view.status).toBe("ready");
    expect(view.scan).toMatchObject({
      posts: 4,
      skipped: { not_public: 9, repost: 2 },
      first: "2019-03",
      last: "2019-04",
      fromRef: 0,
      months: [
        { month: "2019-03", groups: [[0, 2, 0, 0], [1, 1, 0, 0]] },
        { month: "2019-04", groups: [[0, 1, 0, 0]] },
      ],
    });
    // The view carries the facts without their offsets, and the three newest lines as samples, by day.
    expect(view.scan).not.toHaveProperty("pages");
    expect(view.samples).toEqual([
      { at: "2019-04-02", text: "imported line 3" },
      { at: "2019-03-03", text: "imported line 2" },
      { at: "2019-03-02", text: "imported line 1" },
    ]);
    const row = await h.row(id);
    expect(row?.scanned_at).not.toBeNull();
    expect(ImportScanFacts.parse(row!.scan).pages).toHaveLength(1);
    // A round more changes nothing.
    expect((await drive()).ready).toBe(0);
  });

  test("lines the account's posts already carry are counted already_imported, through the social module; a young account offers its newest thousand", async () => {
    const { b, id: first, ownerId } = await uploaded({ ageDays: 40 });
    // A post of an earlier import of this account, written as the migrator, carrying the key of line 1.
    const earlier = randomUUID();
    await h.migrateDb.execute(sql`insert into import_jobs (id, owner_id, source, declared_bytes, status, ended_at, posts_published) values (${earlier}::uuid, ${ownerId}::uuid, 'mastodon', 10, 'done', now(), 1)`);
    await h.migrateDb.execute(sql`insert into posts (id, author_id, body, import_job_id, import_source, original_created_at, import_shortened, import_key)
                                   values (${randomUUID()}::uuid, ${ownerId}::uuid, 'imported before', ${earlier}::uuid, 'mastodon', '2019-03-02T12:00:00Z', false, decode(${line(1).key}, 'hex'))`);
    writeScanOutput(h.work.root, [line(0), line(1), line(2)], scanned(first, 3));
    await drive();
    const view = await viewOf(b, first);
    expect([view.status, view.scan?.posts, view.scan?.skipped]).toEqual(["ready", 2, { already_imported: 1 }]);
    await h.migrateDb.execute(sql`delete from posts where import_job_id = ${earlier}::uuid`);

    const young = await uploaded({ ageDays: 8 });
    const many = Array.from({ length: IMPORT_RULES.newAccountMaxPosts + 3 }, (_, ref) => line(ref));
    writeScanOutput(h.work.root, many, scanned(young.id, many.length));
    await drive();
    const capped = ImportScanFacts.parse((await h.row(young.id))!.scan);
    expect([capped.posts, capped.fromRef, capped.skipped]).toEqual([IMPORT_RULES.newAccountMaxPosts, 3, { new_account_cap: 3 }]);
    expect(capped.pages).toHaveLength(IMPORT_RULES.newAccountMaxPosts / IMPORT_RULES.pageLines);
  });

  test("a failed summary fails the import with its code and asks the importer for the work folder; a summary the API cannot take fails it unreadable", async () => {
    const failed = await uploaded();
    writeScanOutput(h.work.root, [], { v: 1, id: failed.id, status: "failed", failure: "encrypted" });
    await drive();
    const view = await viewOf(failed.b, failed.id);
    expect([view.status, view.failure, view.endedAt !== null, view.scan]).toEqual(["failed", "encrypted", true, null]);
    expect((await h.row(failed.id))?.scanned_at).not.toBeNull();
    expect(existsSync(h.archives.jobDir(failed.id))).toBe(false);
    expect(existsSync(h.archives.deletion(failed.id))).toBe(true);

    // Not JSON.
    const garbled = await uploaded();
    mkdirSync(h.work.jobDir(garbled.id), { recursive: true });
    writeFileSync(h.work.summary(garbled.id), "{ not json");
    // Another import's summary, put in this one's place.
    const stolen = await uploaded();
    mkdirSync(h.work.jobDir(stolen.id), { recursive: true });
    writeFileSync(h.work.summary(stolen.id), JSON.stringify(scanned(failed.id, 1)));
    // The job's folder a link to a folder elsewhere (a junction on Windows).
    const linked = await uploaded();
    const elsewhere = path.join(h.root, `elsewhere-${randomBytes(4).toString("hex")}`);
    writeScanOutput(h.work.root, [line(0)], scanned(linked.id, 1));
    renameSync(h.work.jobDir(linked.id), elsewhere);
    symlinkSync(elsewhere, h.work.jobDir(linked.id), "junction");
    // A scanned summary whose posts.jsonl is missing.
    const lost = await uploaded();
    writeScanOutput(h.work.root, [line(0)], scanned(lost.id, 1));
    renameSync(h.work.posts(lost.id), path.join(h.root, `lost-${randomBytes(4).toString("hex")}`));
    await drive();
    for (const each of [garbled, stolen, linked, lost]) {
      const shown = await viewOf(each.b, each.id);
      expect([shown.status, shown.failure], each.id).toEqual(["failed", "unreadable"]);
      expect(existsSync(h.archives.jobDir(each.id))).toBe(false);
    }
  });

  test("4.8: a scan not done 45 minutes after its upload, or 24 hours after its creation if that is sooner, fails as scan_timed_out", async () => {
    const slow = await uploaded();
    const now = Date.now();
    await drive(new Date(now + 44 * MINUTE));
    expect((await viewOf(slow.b, slow.id)).status).toBe("scanning");
    const report = await drive(new Date(now + 46 * MINUTE));
    expect(report.timedOutScans).toBeGreaterThanOrEqual(1);
    const view = await viewOf(slow.b, slow.id);
    expect([view.status, view.failure]).toEqual(["failed", "scan_timed_out"]);
    expect((await h.row(slow.id))?.scanned_at).not.toBeNull();
    expect(existsSync(h.archives.jobDir(slow.id)) || existsSync(h.archives.queued(slow.id))).toBe(false);
    expect(existsSync(h.archives.deletion(slow.id))).toBe(true);

    // Created 23 hours 50 minutes ago and uploaded now: the day's bound comes first, ten minutes from now.
    const late = await uploaded();
    await h.migrateDb.execute(sql`update import_jobs set created_at = now() - interval '23 hours 50 minutes' where id = ${late.id}::uuid`);
    await drive(new Date(Date.now() + 9 * MINUTE));
    expect((await viewOf(late.b, late.id)).status).toBe("scanning");
    await drive(new Date(Date.now() + 11 * MINUTE));
    expect((await viewOf(late.b, late.id)).failure).toBe("scan_timed_out");
  });

  test("4.8: an upload not complete 24 hours after its creation expires and its part goes; a preview not confirmed 24 hours after its scan expires, its scan cut down", async () => {
    const account = await h.signUp();
    const archive = zipArchive(IMPORT_RULES.chunkBytes + 10);
    const half = await h.created(account.b, { source: "mastodon", bytes: archive.length });
    expect((await h.chunk(account.b, half.id, 0, archive.subarray(0, IMPORT_RULES.chunkBytes))).status).toBe(200);
    const now = Date.now();
    await drive(new Date(now + 23 * HOUR));
    expect((await viewOf(account.b, half.id)).status).toBe("uploading");
    await drive(new Date(now + 24 * HOUR + MINUTE));
    const expired = await viewOf(account.b, half.id);
    expect([expired.status, expired.endedAt !== null]).toEqual(["expired", true]);
    expect(existsSync(h.archives.jobDir(half.id))).toBe(false);

    const preview = await uploaded();
    writeScanOutput(h.work.root, [line(0), line(1)], scanned(preview.id, 2, { skipped: { not_public: 4, poll: 1 } }));
    await drive();
    expect((await viewOf(preview.b, preview.id)).status).toBe("ready");
    await drive(new Date(Date.now() + 23 * HOUR));
    expect((await viewOf(preview.b, preview.id)).status).toBe("ready");
    await drive(new Date(Date.now() + 24 * HOUR + MINUTE));
    const gone = await viewOf(preview.b, preview.id);
    expect(gone.status).toBe("expired");
    // The counts the result shows stay; the month table, the samples and the not-public count go (decision 25).
    expect(gone.scan).toMatchObject({ posts: 2, months: [], skipped: { poll: 1 } });
    expect(gone.scan?.skipped).not.toHaveProperty("not_public");
    expect(gone.samples).toEqual([]);
    expect(ImportScanFacts.parse((await h.row(preview.id))!.scan)).toMatchObject({ samples: [], pages: [] });
    expect(existsSync(h.archives.deletion(preview.id))).toBe(true);
  });

  test("4.8: an import not finished 72 hours after its scan stops as time_ran_out, its seed cleared", async () => {
    const { id: ownerId } = await h.signUp();
    const late = randomUUID();
    await h.migrateDb.execute(sql`insert into import_jobs (id, owner_id, source, declared_bytes, received_bytes, status, uploaded_at, scanned_at, confirmed_at, choice, stated_at, seed, scan)
      values (${late}::uuid, ${ownerId}::uuid, 'x', 10, 10, 'publishing', now() - interval '73 hours', now() - interval '72 hours 1 minute', now() - interval '71 hours',
              '{"from":null,"to":null,"replies":false,"warnings":false,"protected":false,"images":false,"long":"leave"}'::jsonb, now() - interval '71 hours', ${randomBytes(32)}::bytea,
              '{"months":[],"samples":[],"pages":[]}'::jsonb)`);
    const report = await drive();
    expect(report.stoppedLate).toBe(1);
    const [row] = await h.migrateDb.execute<{ status: string; stop_reason: string; seed: Buffer | null; ended_at: Date | null }>(sql`select status::text as status, stop_reason, seed, ended_at from import_jobs where id = ${late}::uuid`);
    expect({ ...row, ended_at: row!.ended_at !== null }).toEqual({ status: "stopped", stop_reason: "time_ran_out", seed: null, ended_at: true });
  });

  test("retention: the picks of an import that ended go; a row ended more than 30 days ago that no post names goes, a younger one stays", async () => {
    const { id: ownerId } = await h.signUp();
    const old = randomUUID();
    const recent = randomUUID();
    const named = randomUUID();
    for (const [id, days] of [[old, 31], [recent, 29], [named, 31]] as const) {
      await h.migrateDb.execute(sql`insert into import_jobs (id, owner_id, source, declared_bytes, status, ended_at, posts_published) values (${id}::uuid, ${ownerId}::uuid, 'x', 10, 'done', now() - make_interval(days => ${days}), 1)`);
    }
    await h.migrateDb.execute(sql`insert into import_picks (import_job_id, ref, left_out, month, marks) values (${recent}::uuid, 0, true, '2019-03', 0)`);
    await h.migrateDb.execute(sql`insert into posts (id, author_id, body, import_job_id, import_source, original_created_at, import_shortened, import_key)
                                   values (${randomUUID()}::uuid, ${ownerId}::uuid, 'still here', ${named}::uuid, 'x', '2019-03-02T12:00:00Z', false, decode(${line(77).key}, 'hex'))`);
    const report = await drive();
    expect(report.rowsDeleted).toBe(1);
    expect(report.picksDeleted).toBe(1);
    const left = await h.migrateDb.execute<{ id: string }>(sql`select id from import_jobs where owner_id = ${ownerId}::uuid order by id`);
    expect(left.map((row) => row.id).sort()).toEqual([recent, named].sort());
    await h.migrateDb.execute(sql`delete from posts where import_job_id = ${named}::uuid`);
  });

  test("orphans, every tenth round: an archive folder or marker of no import, or of one past its scan, goes; a work folder no import needs is asked for; a request carried out is withdrawn after an hour", async () => {
    const at = new Date();
    const old = (file: string) => utimesSync(file, new Date(at.getTime() - 2 * HOUR), new Date(at.getTime() - 2 * HOUR));
    // No row at all.
    const stray = randomUUID();
    mkdirSync(h.archives.jobDir(stray), { recursive: true });
    writeFileSync(h.archives.queued(stray), "");
    mkdirSync(h.work.jobDir(stray), { recursive: true });
    for (const file of [h.archives.jobDir(stray), h.archives.queued(stray), h.work.jobDir(stray)]) old(file);
    // A fresh stray is left for now: it may be a write in flight.
    const fresh = randomUUID();
    mkdirSync(h.archives.jobDir(fresh), { recursive: true });
    // A row that is waiting for its scan keeps its archive whatever its age.
    const waiting = await uploaded();
    old(h.archives.jobDir(waiting.id));
    old(h.archives.queued(waiting.id));
    // A request whose work folder is gone, an hour and more old.
    const done = randomUUID();
    writeFileSync(h.archives.deletion(done), "");
    old(h.archives.deletion(done));

    const report = await h.imports.drive(at, { orphans: true });
    expect(report.orphanArchives).toBeGreaterThanOrEqual(1);
    expect(existsSync(h.archives.jobDir(stray)) || existsSync(h.archives.queued(stray))).toBe(false);
    expect(existsSync(h.archives.deletion(stray))).toBe(true);
    expect(existsSync(h.archives.jobDir(fresh))).toBe(true);
    expect(existsSync(h.archives.archive(waiting.id)) && existsSync(h.archives.queued(waiting.id))).toBe(true);
    expect(existsSync(h.archives.deletion(done))).toBe(false);
    // The importer carries the request out; an hour later it is withdrawn.
    old(h.archives.deletion(stray));
    await h.imports.drive(at, { orphans: true });
    expect(existsSync(h.archives.deletion(stray))).toBe(true);
    rmWork(stray);
    await h.imports.drive(at, { orphans: true });
    expect(existsSync(h.archives.deletion(stray))).toBe(false);
    // Rounds without the orphans' step touch none of it.
    mkdirSync(h.archives.jobDir(stray), { recursive: true });
    old(h.archives.jobDir(stray));
    await drive(at);
    expect(existsSync(h.archives.jobDir(stray))).toBe(true);
  });

  /** What the importer does on a deletion request. */
  function rmWork(id: string) {
    renameSync(h.work.jobDir(id), path.join(h.root, `removed-${id}`));
  }

  test("this file left no import row behind", async () => {
    const { now, before } = await h.cleanup();
    expect(now).toEqual(before);
  });
});
