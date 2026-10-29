import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { upload } from "../../src/media/flows/upload";
import { MemoryJobLock } from "../../src/lib/jobs";
import {
  DELETION_GRACE_MS,
  ORPHAN_AGE_MS,
  PROCESSING_TIMEOUT_MS,
  RECONCILE_INTERVAL_MS,
  RECONCILE_MAX_ORPHANS,
  SWEEP_INTERVAL_MS,
  UNATTACHED_TTL_MS,
  createSweeper,
  sweep,
} from "../../src/media/sweeper";
import { mediaHarness, type MediaHarness } from "./media-harness";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The sweep acts on every row in the database, and other test files run next to this one. So this
 * file never moves "now": it makes its own rows old by starting a harness clock in the past, and
 * sweeps at the real time. Rows other files create are seconds old and stay out of reach.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the media sweeper", () => {
  let db: Db;
  const harnesses: MediaHarness[] = [];
  const started = (ago: number) => mediaHarness(db, { clockStart: Date.now() - ago }).then((h) => (harnesses.push(h), h));
  const now = () => new Date();

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
  });
  afterAll(async () => {
    for (const h of harnesses) h.cleanup();
    await closeDb(db);
  });

  test("the numbers", () => {
    expect([PROCESSING_TIMEOUT_MS, UNATTACHED_TTL_MS, ORPHAN_AGE_MS, SWEEP_INTERVAL_MS, RECONCILE_INTERVAL_MS]).toEqual([5 * MINUTE, 24 * HOUR, HOUR, 30_000, 10 * MINUTE]);
    expect(DELETION_GRACE_MS).toBe(10 * MINUTE);
  });

  test("a result nobody asked for is recorded, and the upload is removed", async () => {
    const h = await started(MINUTE);
    const ada = await h.established();
    const sent = await upload(h.deps, ada.id, h.jpeg());
    h.worker.ready(sent.id, { width: 640, height: 480 });
    const report = await sweep(h.deps, now(), { reconcile: false });
    expect(report.finalized).toBeGreaterThanOrEqual(1);
    expect(await h.deps.repo.find(sent.id)).toMatchObject({ status: "ready", width: 640, height: 480 });
    expect(existsSync(h.files.uploads.upload(sent.id))).toBe(false);
  });

  test("an upload the worker never answered fails after five minutes; a younger one is left alone", async () => {
    const old = await started(6 * MINUTE);
    const young = await started(MINUTE);
    const [ada, bob] = [await old.established(), await young.established()];
    const stuck = await upload(old.deps, ada.id, old.jpeg());
    const waiting = await upload(young.deps, bob.id, young.jpeg());

    expect((await sweep(old.deps, now(), { reconcile: false })).timedOut).toBeGreaterThanOrEqual(1);
    expect(await old.deps.repo.find(stuck.id)).toMatchObject({ status: "failed", error: "processing_failed" });
    expect(existsSync(old.files.uploads.upload(stuck.id))).toBe(false);
    expect(await old.files.deletionRequests()).toContain(stuck.id);
    expect(await young.deps.repo.find(waiting.id)).toMatchObject({ status: "processing" });
    expect(existsSync(young.files.uploads.upload(waiting.id))).toBe(true);
  });

  test("uploads nobody posted within a day are removed with their files; images on posts stay", async () => {
    const h = await started(25 * HOUR);
    const ada = await h.established();
    const forgotten = await h.readyImage(ada.id);
    const refused = await upload(h.deps, ada.id, h.jpeg());
    h.worker.failed(refused.id, "corrupt_image");
    const { mediaIds } = await h.postWithImages(ada.id);

    expect((await sweep(h.deps, now(), { reconcile: false })).expired).toBeGreaterThanOrEqual(2);
    expect(await h.deps.repo.find(forgotten)).toBeNull();
    expect(await h.deps.repo.find(refused.id)).toBeNull();
    expect(await h.files.deletionRequests()).toEqual(expect.arrayContaining([forgotten, refused.id]));
    expect(await h.deps.repo.find(mediaIds[0]!)).toMatchObject({ status: "ready" });
    expect(await h.files.deletionRequests()).not.toContain(mediaIds[0]);
  });

  test("a deletion request is withdrawn once the worker has removed everything, but not before it is ten minutes old", async () => {
    const h = await started(MINUTE);
    const [done, pending, fresh] = [h.newId(), h.newId(), h.newId()];
    mkdirSync(h.files.store.imageDir(pending), { recursive: true });
    await h.files.requestDeletion([done, pending, fresh]);
    const elevenMinutesAgo = new Date(Date.now() - 11 * MINUTE);
    for (const id of [done, pending]) utimesSync(h.files.uploads.deletion(id), elevenMinutesAgo, elevenMinutesAgo);

    expect((await sweep(h.deps, now(), { reconcile: false })).withdrawn).toBe(1);
    expect((await h.files.deletionRequests()).sort()).toEqual([pending, fresh].sort());
  });

  test("reconcile: old files without a row are removed, young ones and ones with a row are not", async () => {
    const h = await started(MINUTE);
    const ada = await h.established();
    const longAgo = new Date(Date.now() - 2 * HOUR);
    const age = (path: string) => utimesSync(path, longAgo, longAgo);

    const [orphanImage, youngImage, orphanUpload, youngUpload] = [h.newId(), h.newId(), h.newId(), h.newId()];
    for (const id of [orphanImage, youngImage]) mkdirSync(h.files.store.imageDir(id), { recursive: true });
    age(h.files.store.imageDir(orphanImage));
    for (const id of [orphanUpload, youngUpload]) writeFileSync(h.files.uploads.upload(id), "bytes");
    age(h.files.uploads.upload(orphanUpload));
    const owned = await h.readyImage(ada.id);
    age(h.files.store.imageDir(owned));

    expect((await sweep(h.deps, now(), { reconcile: false })).orphans).toBe(0);
    expect((await sweep(h.deps, now(), { reconcile: true })).orphans).toBe(2);
    expect(await h.files.deletionRequests()).toEqual([orphanImage]);
    expect(existsSync(h.files.uploads.upload(orphanUpload))).toBe(false);
    expect(existsSync(h.files.uploads.upload(youngUpload))).toBe(true);
    expect(existsSync(h.files.store.imageDir(owned))).toBe(true);
  });

  test("2d Task 3 (7.2, 7.8): the sweeper's day takes an avatar's upload never set and leaves a set avatar; reconcile removes an old job file left alone, and keeps a young one and one whose upload has a row", async () => {
    const h = await started(25 * HOUR);
    const ada = await h.established();
    const current = await h.readyAvatar(ada.id);
    await db.transaction((tx) => h.deps.repo.attachAvatar(tx, ada.id, current));
    const unset = await h.readyAvatar(ada.id, "end");
    expect((await sweep(h.deps, now(), { reconcile: false })).expired).toBeGreaterThanOrEqual(1);
    expect(await h.deps.repo.find(unset)).toBeNull();
    expect(await h.files.deletionRequests()).toContain(unset);
    expect(await h.deps.repo.find(current)).toMatchObject({ status: "ready" });
    expect(await h.files.deletionRequests()).not.toContain(current);

    // Volumes of their own, and a row made a minute ago, which no other step of the sweep takes. A job file whose upload's
    // rename never came (a crash between the two), two hours old: no upload and no row by its id; and a young one.
    const y = await started(MINUTE);
    const bob = await y.established();
    const longAgo = new Date(Date.now() - 2 * HOUR);
    const [orphan, young] = [y.newId(), y.newId()];
    for (const id of [orphan, young]) writeFileSync(y.files.uploads.avatarJob(id), JSON.stringify({ v: 1, crop: "start" }));
    utimesSync(y.files.uploads.avatarJob(orphan), longAgo, longAgo);
    // An avatar's upload waiting for the worker, with its row, its job file and its upload as old.
    const waiting = await upload(y.deps, bob.id, { ...y.jpeg(), avatar: { crop: "centre" } });
    for (const file of [y.files.uploads.avatarJob(waiting.id), y.files.uploads.upload(waiting.id)]) utimesSync(file, longAgo, longAgo);

    // One orphan: the job file under its id, counted once.
    expect((await sweep(y.deps, now(), { reconcile: true })).orphans).toBe(1);
    expect(existsSync(y.files.uploads.avatarJob(orphan))).toBe(false);
    expect(existsSync(y.files.uploads.avatarJob(young))).toBe(true);
    expect(existsSync(y.files.uploads.avatarJob(waiting.id))).toBe(true);
    expect(existsSync(y.files.uploads.upload(waiting.id))).toBe(true);
  });

  test("only the instance that holds the lock sweeps; it reconciles once every ten minutes and releases the lock afterwards", async () => {
    const h = await started(MINUTE);
    const lock = new MemoryJobLock();
    await lock.acquire("job:media-sweeper", "another instance", 60_000);
    expect(await createSweeper(h.deps, lock).round()).toBeNull();
    await lock.release("job:media-sweeper", "another instance");

    const orphan = h.newId();
    mkdirSync(h.files.store.imageDir(orphan), { recursive: true });
    const longAgo = new Date(Date.now() - 2 * HOUR);
    utimesSync(h.files.store.imageDir(orphan), longAgo, longAgo);
    h.deps.now = () => new Date();
    const sweeper = createSweeper(h.deps, lock);
    expect((await sweeper.round())?.orphans).toBe(1);
    expect((await sweeper.round())?.orphans).toBe(0);
    expect(await lock.acquire("job:media-sweeper", "another instance", 60_000)).toBe(true);
    expect(await lock.acquire("job:media-sweeper:reconcile", "x", RECONCILE_INTERVAL_MS)).toBe(false);
  });

  test("reconcile refuses to delete many images without a row unless forced, and can be switched off", async () => {
    const h = await started(MINUTE);
    const longAgo = new Date(Date.now() - 2 * HOUR);
    const orphans: string[] = [];
    for (let i = 0; i <= RECONCILE_MAX_ORPHANS; i++) {
      const id = h.newId();
      mkdirSync(h.files.store.imageDir(id), { recursive: true });
      utimesSync(h.files.store.imageDir(id), longAgo, longAgo);
      orphans.push(id);
    }
    const refused = await sweep(h.deps, now(), { reconcile: true });
    expect(refused.refused).toBe(orphans.length);
    expect(refused.orphans).toBe(0);
    expect(await h.files.deletionRequests()).toEqual([]);

    h.deps.reconcileMode = "off";
    expect(await sweep(h.deps, now(), { reconcile: true })).toMatchObject({ orphans: 0, refused: 0 });

    h.deps.reconcileMode = "force";
    expect((await sweep(h.deps, now(), { reconcile: true })).orphans).toBe(orphans.length);
    expect((await h.files.deletionRequests()).sort()).toEqual([...orphans].sort());
  });
});
