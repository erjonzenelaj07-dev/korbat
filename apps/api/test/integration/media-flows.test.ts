import { existsSync, readdirSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MEDIA_MAX_BYTES, MediaStatusResponse, UploadResponse } from "@korbat/contracts";
import { closeDb, createDb, postMedia, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { remove } from "../../src/media/flows/remove";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { createSocialRepo } from "../../src/social/repo";
import { BYTES, bodyOf, mediaHarness, type MediaHarness } from "./media-harness";
import { liftRowForTest, suspendRowForTest } from "./moderation-fixtures";
import { rejection } from "./social-harness";
import { newPost } from "./social-fixtures";

describe.skipIf(!process.env.INTEGRATION)("integration: media upload, status and removal", () => {
  let db: Db;
  let migrateDb: Db;
  let h: MediaHarness;

  beforeAll(async () => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    // 3e: only the migrator writes a suspension into a profile row, as the ledger's standing_apply does.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 1 });
    h = await mediaHarness(db);
  });
  afterAll(async () => {
    h.cleanup();
    await Promise.all([closeDb(db), closeDb(migrateDb)]);
  });

  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return null;
    } catch (err) {
      const e = err as { code?: string; status?: number; message?: string };
      return { code: e.code, status: e.status, message: e.message };
    }
  };

  test("an upload is stored for the worker and owned by its account; the worker's verdict is recorded once", async () => {
    const ada = await h.established();
    const sent = UploadResponse.parse(await upload(h.deps, ada.id, h.jpeg()));
    expect(readFileSync(h.files.uploads.upload(sent.id))).toEqual(BYTES.jpeg);
    expect(readdirSync(h.files.uploads.tmp)).toEqual([]);
    expect(await status(h.deps, ada.id, sent.id)).toEqual({ id: sent.id, status: "processing" });

    h.worker.ready(sent.id, { width: 1600, height: 1200 });
    const ready = MediaStatusResponse.parse(await status(h.deps, ada.id, sent.id));
    expect(ready).toEqual({ id: sent.id, status: "ready", width: 1600, height: 1200, blurhash: "L2Eo_P_3jb_3~qoL" });
    expect(existsSync(h.files.uploads.upload(sent.id))).toBe(false);

    h.worker.failed(sent.id, "corrupt_image");
    expect(await status(h.deps, ada.id, sent.id)).toEqual(ready);
  });

  test("a refused image reports the worker's reason", async () => {
    const ada = await h.established();
    const sent = await upload(h.deps, ada.id, h.jpeg());
    h.worker.failed(sent.id, "animated_not_supported");
    expect(await status(h.deps, ada.id, sent.id)).toEqual({ id: sent.id, status: "failed", error: "animated_not_supported" });
    expect(existsSync(h.files.uploads.upload(sent.id))).toBe(false);
  });

  test("the status of an upload is for its owner only", async () => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    const sent = await upload(h.deps, ada.id, h.jpeg());
    expect(await rejection(status(h.deps, bob.id, sent.id))).toBe("not_found");
    expect(await rejection(status(h.deps, ada.id, h.newId()))).toBe("not_found");
  });

  test("the declared type must be an accepted image type; HEIC is told what to do", async () => {
    const ada = await h.established();
    for (const contentType of [undefined, "", "text/plain", "image/svg+xml", "image/tiff", "application/octet-stream"]) {
      expect(await failure(upload(h.deps, ada.id, { ...h.jpeg(), contentType })), String(contentType)).toMatchObject({ code: "unsupported_media_type", status: 415 });
    }
    expect((await failure(upload(h.deps, ada.id, { ...h.jpeg(), contentType: "image/heic" })))?.message).toMatch(/Export the photo as JPEG/);
    expect((await upload(h.deps, ada.id, { ...h.jpeg(), contentType: "IMAGE/JPEG; charset=binary" })).status).toBe("processing");
  });

  test("the first bytes decide, and a refused file leaves no row and no file", async () => {
    const ada = await h.established();
    const before = await h.deps.repo.pendingCount(ada.id);
    expect(await failure(upload(h.deps, ada.id, { ...h.jpeg(), body: bodyOf(BYTES.pdf) }))).toMatchObject({ code: "unsupported_media_type", status: 415 });
    expect((await failure(upload(h.deps, ada.id, { ...h.jpeg(), body: bodyOf(BYTES.heic) })))?.message).toMatch(/Export the photo as JPEG/);
    expect((await failure(upload(h.deps, ada.id, { contentType: "image/webp", contentLength: undefined, body: bodyOf(BYTES.animatedWebp) })))?.message).toMatch(/Animated images/);
    expect(await failure(upload(h.deps, ada.id, { ...h.jpeg(), body: null }))).toMatchObject({ code: "unsupported_media_type" });
    expect(await h.deps.repo.pendingCount(ada.id)).toBe(before);
    expect(readdirSync(h.files.uploads.tmp)).toEqual([]);
    expect((await upload(h.deps, ada.id, { contentType: "image/jpeg", contentLength: undefined, body: bodyOf(BYTES.png) })).status).toBe("processing");
  });

  test("a format that is switched off is refused by type and by bytes", async () => {
    const only = await mediaHarness(db, { formats: ["jpeg"] });
    const ada = await only.established();
    expect(await failure(upload(only.deps, ada.id, { contentType: "image/png", contentLength: undefined, body: bodyOf(BYTES.png) }))).toMatchObject({ code: "unsupported_media_type" });
    expect(await failure(upload(only.deps, ada.id, { contentType: "image/jpeg", contentLength: undefined, body: bodyOf(BYTES.png) }))).toMatchObject({ code: "unsupported_media_type" });
    expect((await upload(only.deps, ada.id, only.jpeg())).status).toBe("processing");
    only.cleanup();
  });

  test("20 MiB is the limit, whether the length is declared or not", async () => {
    const ada = await h.established();
    expect(await failure(upload(h.deps, ada.id, { ...h.jpeg(), contentLength: String(MEDIA_MAX_BYTES + 1) }))).toMatchObject({ code: "file_too_large", status: 413 });
    const mib = new Uint8Array(1024 * 1024);
    const chunks = [BYTES.jpeg, ...Array.from({ length: 20 }, () => mib)];
    expect(await failure(upload(h.deps, ada.id, { ...h.jpeg(), contentLength: "1000", body: bodyOf(...chunks) }))).toMatchObject({ code: "file_too_large", status: 413 });
    expect(readdirSync(h.files.uploads.tmp)).toEqual([]);
  });

  test("an account holds at most 20 uploads that are not on a post", async () => {
    const ada = await h.established();
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push((await upload(h.deps, ada.id, h.jpeg())).id);
    expect(await failure(upload(h.deps, ada.id, h.jpeg()))).toMatchObject({ code: "too_many_pending_uploads", status: 409 });
    h.worker.failed(ids[0]!, "corrupt_image");
    await status(h.deps, ada.id, ids[0]!);
    expect((await upload(h.deps, ada.id, h.jpeg())).status).toBe("processing");
  });

  test("an account in its first day may upload 20 images an hour, and removing them gives nothing back", async () => {
    const newcomer = await h.fresh();
    for (let i = 0; i < 20; i++) await remove(h.deps, newcomer.id, (await upload(h.deps, newcomer.id, h.jpeg())).id);
    const refused = await failure(upload(h.deps, newcomer.id, h.jpeg()));
    expect(refused).toMatchObject({ code: "rate_limited", status: 429 });
  });

  test("uploads stop while the disk is nearly full", async () => {
    const full = await mediaHarness(db, { minFreeBytes: Number.MAX_SAFE_INTEGER });
    const ada = await full.established();
    expect(await failure(upload(full.deps, ada.id, full.jpeg()))).toMatchObject({ code: "uploads_unavailable", status: 503 });
    full.cleanup();
  });

  test("an account without a profile cannot upload", async () => {
    expect(await rejection(upload(h.deps, h.newId(), h.jpeg()))).toBe("not_found");
  });

  test("3e: while the account's suspension runs, an upload is refused account_suspended (403) by the statement that writes its row: no row is left and the received file is discarded", async () => {
    const ada = await h.established();
    await suspendRowForTest(migrateDb, ada.id);
    const before = await h.deps.repo.pendingCount(ada.id);
    const uploads = readdirSync(h.files.uploads.incoming).length;
    expect(await failure(upload(h.deps, ada.id, h.jpeg()))).toMatchObject({ code: "account_suspended", status: 403 });
    expect(await h.deps.repo.pendingCount(ada.id)).toBe(before);
    expect(readdirSync(h.files.uploads.tmp)).toEqual([]);
    expect(readdirSync(h.files.uploads.incoming).length).toBe(uploads);
    await liftRowForTest(migrateDb, ada.id);
    expect((await upload(h.deps, ada.id, h.jpeg())).status).toBe("processing");
  });

  test("removing an upload deletes its row and file and asks the worker to delete what it made", async () => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    const sent = await upload(h.deps, ada.id, h.jpeg());
    h.worker.ready(sent.id);
    expect(await rejection(remove(h.deps, bob.id, sent.id))).toBe("not_found");
    await remove(h.deps, ada.id, sent.id);
    expect(await h.deps.repo.find(sent.id)).toBeNull();
    expect(existsSync(h.files.uploads.upload(sent.id))).toBe(false);
    expect(await h.files.deletionRequests()).toContain(sent.id);
    expect(await rejection(remove(h.deps, ada.id, sent.id))).toBe("not_found");
  });

  test("an image that is on a post cannot be removed on its own", async () => {
    const ada = await h.established();
    const sent = await upload(h.deps, ada.id, h.jpeg());
    h.worker.ready(sent.id);
    await status(h.deps, ada.id, sent.id);
    const postId = await newPost(createSocialRepo(db), ada.id, h.clock.next(), "with an image");
    await db.update(postMedia).set({ postId, position: 0, altText: "a test image" }).where(eq(postMedia.id, sent.id));
    expect(await rejection(remove(h.deps, ada.id, sent.id))).toBe("not_found");
    expect((await h.deps.repo.find(sent.id))?.postId).toBe(postId);
  });
});
