import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { MediaStatusResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import type { MediaDeps } from "../../src/media/context";
import { serve } from "../../src/media/flows/serve";
import { status } from "../../src/media/flows/status";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { openCase, rowCounts } from "./moderation-fixtures";
import { rejection } from "./social-harness";
import { rolledBack } from "./staff-fixtures";

// Each test builds a store directory, uploads its images and reads them back inside one open transaction: on a loaded
// machine that takes longer than the five seconds a test gets by default.
vi.setConfig({ testTimeout: 30_000 });

/**
 * The image readers fail closed (3c design, sections 5 and 7.10, gate S) before any code can write the state `sealed`: an
 * image in that state is served, listed and exported to nobody, its author included, and its status carries no blurhash.
 * Only a migrator-owned function will ever write an image's moderation state, and none exists yet, so each test runs as
 * the migrator inside one transaction that is rolled back: it makes its accounts, posts and images there, sets the state,
 * and runs the readers on that same transaction. A sealed image that no decision sealed never reaches the database's
 * other readers, and the file's last test holds it to leaving no row behind.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: a sealed image reaches nobody", () => {
  let migrateDb: Db;
  let before: Record<string, number>;

  beforeAll(async () => {
    // The migrate role is not part of the API configuration; the test environment carries it.
    migrateDb = createDb(process.env.DATABASE_URL_MIGRATE!, { max: 2 });
    before = await rowCounts(migrateDb);
  });
  afterAll(async () => {
    await closeDb(migrateDb);
  });

  /** The media module on a transaction of the migrator that is rolled back, with a store directory of its own. */
  const inWorld = (fn: (h: MediaHarness, tx: DbTx) => Promise<void>) =>
    rolledBack(migrateDb, async (tx) => {
      const h = await mediaHarness(tx as unknown as Db);
      try {
        await fn(h, tx);
      } finally {
        h.cleanup();
      }
    });
  /** Sets the images' moderation state as the migrator, which stands in for the function of a later migration. */
  const seal = (tx: DbTx, mediaIds: readonly string[]) => tx.execute(sql`update post_media set moderation_state = 'sealed' where id = any(${`{${mediaIds.join(",")}}`}::uuid[])`);
  /** What serve answers for the large file, with the file it opened closed again. */
  async function ask(deps: MediaDeps, id: string, viewer: string | null, ifNoneMatch?: string) {
    const served = await serve(deps, { id, size: "large", ifNoneMatch, viewer: async () => viewer });
    if (served.kind === "file") await served.file.handle.close();
    return served.kind === "not_found" ? { kind: served.kind } : { kind: served.kind, cacheControl: served.cacheControl };
  }

  test("serve answers a sealed image as not found to its author, to others and signed out, and still serves its sibling", async () => {
    await inWorld(async (h, tx) => {
      const [ada, bob] = [await h.established(), await h.established()];
      const { mediaIds } = await h.postWithImages(ada.id, 2);
      expect((await ask(h.deps, mediaIds[0]!, null)).kind).toBe("file");
      await seal(tx, [mediaIds[0]!]);
      for (const viewer of [ada.id, bob.id, null]) expect((await ask(h.deps, mediaIds[0]!, viewer)).kind, String(viewer)).toBe("not_found");
      // A browser that holds the file's tag gets no "not modified" either.
      expect((await ask(h.deps, mediaIds[0]!, ada.id, `"${mediaIds[0]}-large"`)).kind).toBe("not_found");
      expect(await ask(h.deps, mediaIds[1]!, null)).toEqual({ kind: "file", cacheControl: "public, max-age=300" });
    });
  });

  test.each(["withheld", "removed"] as const)("a sealed image of a %s post is not found for its author too, who still gets the post's other image", async (state) => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const { postId, mediaIds } = await h.postWithImages(ada.id, 2);
      await seal(tx, [mediaIds[0]!]);
      await tx.execute(sql`update posts set state = ${state}::post_state where id = ${postId}::uuid`);
      // The seal is tested before the author's branch.
      expect((await ask(h.deps, mediaIds[0]!, ada.id)).kind).toBe("not_found");
      expect(await ask(h.deps, mediaIds[1]!, ada.id)).toEqual({ kind: "file", cacheControl: "private, no-store" });
    });
  });

  test("forPosts lists a post's images without the sealed one", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const { postId, mediaIds } = await h.postWithImages(ada.id, 3);
      expect(((await h.deps.repo.forPosts([postId])).get(postId) ?? []).map((image) => image.id)).toEqual(mediaIds);
      await seal(tx, [mediaIds[1]!]);
      expect(((await h.deps.repo.forPosts([postId])).get(postId) ?? []).map((image) => image.id)).toEqual([mediaIds[0], mediaIds[2]]);
      await seal(tx, mediaIds);
      expect((await h.deps.repo.forPosts([postId])).get(postId)).toBeUndefined();
    });
  });

  test("readyImages, which names the files of an export, leaves the sealed image out", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const { mediaIds } = await h.postWithImages(ada.id, 2);
      const upload = await h.readyImage(ada.id);
      expect(await h.deps.repo.readyImages(ada.id)).toEqual([...mediaIds, upload]);
      await seal(tx, [mediaIds[0]!]);
      expect(await h.deps.repo.readyImages(ada.id)).toEqual([mediaIds[1], upload]);
    });
  });

  test("find and the status flow answer a sealed image without its blurhash", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const { mediaIds } = await h.postWithImages(ada.id, 2);
      expect(await status(h.deps, ada.id, mediaIds[0]!)).toMatchObject({ status: "ready", blurhash: "L2Eo_P_3jb_3~qoL" });
      await seal(tx, [mediaIds[0]!]);
      expect(await h.deps.repo.find(mediaIds[0]!)).toMatchObject({ id: mediaIds[0], status: "ready", blurhash: null, width: 2048, height: 1536 });
      const answer = await status(h.deps, ada.id, mediaIds[0]!);
      expect(answer).toEqual({ id: mediaIds[0], status: "ready", width: 2048, height: 1536 });
      expect("blurhash" in answer).toBe(false);
      // The answer is still one the contract knows.
      expect(MediaStatusResponse.parse(answer)).toEqual(answer);
      // The post's other image is answered as before.
      expect(await status(h.deps, ada.id, mediaIds[1]!)).toMatchObject({ status: "ready", blurhash: "L2Eo_P_3jb_3~qoL" });
    });
  });

  test("find and the status flow answer a kept image of a deleted post as a row that does not exist, to its owner too", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const { postId, mediaIds } = await h.postWithImages(ada.id, 1);
      // A case's hold keeps the row when the post is deleted; the freeze keeps rows the same way.
      await tx.execute(sql`insert into media_holds (media_id, case_id) values (${mediaIds[0]!}::uuid, ${await openCase(tx, "post", postId)}::uuid)`);
      await h.setPostState(postId, "deleted_by_author");
      expect(await h.deps.repo.detachAll(tx, postId)).toEqual([]);
      expect(await h.deps.repo.find(mediaIds[0]!)).toBeNull();
      expect(await rejection(status(h.deps, ada.id, mediaIds[0]!))).toBe("not_found");
      // The row is there: only the readers do not show it.
      expect(await h.deps.repo.existing(mediaIds)).toEqual(new Set(mediaIds));
    });
  });

  test("the same for an image that was erased, and for an image of a post whose content was erased", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const own = await h.postWithImages(ada.id, 1);
      const ofPost = await h.postWithImages(ada.id, 1);
      expect(await status(h.deps, ada.id, own.mediaIds[0]!)).toMatchObject({ status: "ready" });
      // What the R4 redaction will leave: the marks only a migrator-owned function writes.
      await tx.execute(sql`update post_media set erased_at = now() where id = ${own.mediaIds[0]!}::uuid`);
      await tx.execute(sql`update posts set erased_at = now() where id = ${ofPost.postId}::uuid`);
      for (const id of [own.mediaIds[0]!, ofPost.mediaIds[0]!]) {
        expect(await h.deps.repo.find(id), id).toBeNull();
        expect(await rejection(status(h.deps, ada.id, id)), id).toBe("not_found");
      }
    });
  });

  test("an upload on no post is found and answered as before", async () => {
    await inWorld(async (h) => {
      const ada = await h.established();
      const upload = await h.readyImage(ada.id);
      expect(await h.deps.repo.find(upload)).toMatchObject({ id: upload, ownerId: ada.id, postId: null, status: "ready", blurhash: "L2Eo_P_3jb_3~qoL" });
      expect(await status(h.deps, ada.id, upload)).toEqual({ id: upload, status: "ready", width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3~qoL" });
    });
  });

  test("this file left no row behind: the tables it writes hold what they held before it", async () => {
    expect(await rowCounts(migrateDb)).toEqual(before);
  });
});
