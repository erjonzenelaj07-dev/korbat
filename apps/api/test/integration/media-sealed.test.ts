import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { MediaStatusResponse, mediaPath } from "@korbat/contracts";
import { closeDb, createDb, type Db, type DbTx } from "@korbat/db";
import { mediaForAccount } from "../../src/media";
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
 * The image readers fail closed (3c design, sections 5 and 7.10, gate S): an image in the state `sealed` is served,
 * listed with content and exported to nobody, its author included, and its status carries no blurhash; an image follows
 * its own state as well as its post's; and a kept image of a deleted post, and an erased one, reach nobody. Only the migrator-owned
 * moderation_apply writes an image's moderation state, from a decision's ledger; these tests are about the readers, so
 * each runs as the migrator inside one transaction that is rolled back: it makes its accounts, posts and images there,
 * sets the state by hand, and runs the readers on that same transaction. A sealed image that no decision sealed never
 * reaches the database's other readers, and the file's last test holds it to leaving no row behind.
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
  /** Sets the images' moderation state as the migrator, which stands in for a seal's decision. */
  const seal = (tx: DbTx, mediaIds: readonly string[]) => tx.execute(sql`update post_media set moderation_state = 'sealed' where id = any(${`{${mediaIds.join(",")}}`}::uuid[])`);
  /** The same for one image and another state: what a decision on that image alone leaves. */
  const setState = (tx: DbTx, mediaId: string, state: "withheld" | "removed") => tx.execute(sql`update post_media set moderation_state = ${state}::media_moderation_state where id = ${mediaId}::uuid`);
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

  test("forPosts lists each image with its state, and a sealed one as its id and its state only: no size, no blurhash, no alt text, no path", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const { postId, mediaIds } = await h.postWithImages(ada.id, 3);
      const listed = async () => (await h.deps.repo.forPosts([postId])).get(postId) ?? [];
      const whole = (id: string, position: number, state: string) => ({ id, state, width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3~qoL", alt: `image ${position + 1}`, small: mediaPath(id, "small"), large: mediaPath(id, "large") });
      expect(await listed()).toEqual(mediaIds.map((id, position) => whole(id, position, "visible")));
      await seal(tx, [mediaIds[1]!]);
      expect(await listed()).toEqual([whole(mediaIds[0]!, 0, "visible"), { id: mediaIds[1], state: "sealed" }, whole(mediaIds[2]!, 2, "visible")]);
      // A withheld and a removed image are listed whole, with their state: who is shown them is the view builder's to say.
      await setState(tx, mediaIds[0]!, "withheld");
      await setState(tx, mediaIds[2]!, "removed");
      expect(await listed()).toEqual([whole(mediaIds[0]!, 0, "withheld"), { id: mediaIds[1], state: "sealed" }, whole(mediaIds[2]!, 2, "removed")]);
      await seal(tx, mediaIds);
      expect(await listed()).toEqual(mediaIds.map((id) => ({ id, state: "sealed" })));
    });
  });

  test("forPosts never gives an image of a deleted post, an erased image or an image of a post whose content was erased", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const deleted = await h.postWithImages(ada.id, 2);
      const partly = await h.postWithImages(ada.id, 2);
      const erased = await h.postWithImages(ada.id, 1);
      // The rows of the deleted post are kept, as a hold or a freeze keeps them; the marks are what an R4 redaction leaves.
      await h.setPostState(deleted.postId, "deleted_by_author");
      await tx.execute(sql`update post_media set erased_at = now() where id = ${partly.mediaIds[0]!}::uuid`);
      await tx.execute(sql`update posts set erased_at = now() where id = ${erased.postId}::uuid`);
      const listed = await h.deps.repo.forPosts([deleted.postId, partly.postId, erased.postId]);
      expect([...listed.keys()]).toEqual([partly.postId]);
      expect(listed.get(partly.postId)!.map((image) => image.id)).toEqual([partly.mediaIds[1]]);
      // The rows are all there: only the reader does not give them.
      const all = [...deleted.mediaIds, ...partly.mediaIds, ...erased.mediaIds];
      expect(await h.deps.repo.existing(all)).toEqual(new Set(all));
    });
  });

  test.each(["withheld", "removed"] as const)("an image that is itself %s on a visible post is served to its author only, never cached, and to nobody else", async (state) => {
    await inWorld(async (h, tx) => {
      const [ada, bob] = [await h.established(), await h.established()];
      const { mediaIds } = await h.postWithImages(ada.id, 2);
      await setState(tx, mediaIds[0]!, state);
      expect(await ask(h.deps, mediaIds[0]!, ada.id)).toEqual({ kind: "file", cacheControl: "private, no-store" });
      for (const viewer of [bob.id, null]) expect((await ask(h.deps, mediaIds[0]!, viewer)).kind, String(viewer)).toBe("not_found");
      // The post's other image stays public.
      expect(await ask(h.deps, mediaIds[1]!, null)).toEqual({ kind: "file", cacheControl: "public, max-age=300" });
    });
  });

  test("serve answers an erased image, an image of a post whose content was erased and a kept image of a deleted post as not found, to their author too", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const own = await h.postWithImages(ada.id, 1);
      const ofPost = await h.postWithImages(ada.id, 1);
      const deleted = await h.postWithImages(ada.id, 1);
      await tx.execute(sql`update post_media set erased_at = now() where id = ${own.mediaIds[0]!}::uuid`);
      await tx.execute(sql`update posts set erased_at = now(), state = 'removed' where id = ${ofPost.postId}::uuid`);
      await h.setPostState(deleted.postId, "deleted_by_author");
      for (const id of [own.mediaIds[0]!, ofPost.mediaIds[0]!, deleted.mediaIds[0]!]) {
        for (const viewer of [ada.id, null]) expect((await ask(h.deps, id, viewer)).kind, `${id} ${String(viewer)}`).toBe("not_found");
      }
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

  test("readyImages keeps the author's withheld and removed images, and leaves out an image of a deleted post, an erased image and an image of an erased post", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const kept = await h.postWithImages(ada.id, 2);
      const deleted = await h.postWithImages(ada.id, 1);
      const partly = await h.postWithImages(ada.id, 2);
      const erased = await h.postWithImages(ada.id, 1);
      const upload = await h.readyImage(ada.id);
      await setState(tx, kept.mediaIds[0]!, "withheld");
      await setState(tx, kept.mediaIds[1]!, "removed");
      await h.setPostState(deleted.postId, "deleted_by_author");
      await tx.execute(sql`update post_media set erased_at = now() where id = ${partly.mediaIds[0]!}::uuid`);
      await tx.execute(sql`update posts set erased_at = now() where id = ${erased.postId}::uuid`);
      expect(await h.deps.repo.readyImages(ada.id)).toEqual([...kept.mediaIds, partly.mediaIds[1], upload]);
    });
  });

  test("the export opens a file only for an image its list would still name: one sealed, erased or deleted with its post since the list was read is not opened", async () => {
    await inWorld(async (h, tx) => {
      const ada = await h.established();
      const sealed = await h.postWithImages(ada.id, 1);
      const deleted = await h.postWithImages(ada.id, 1);
      const erased = await h.postWithImages(ada.id, 1);
      const still = await h.postWithImages(ada.id, 1);
      // The list is read first, as the export reads it before the archive's first byte.
      const images = await mediaForAccount(h.deps).exportImages(ada.id);
      expect(images.map((image) => image.id)).toEqual([...sealed.mediaIds, ...deleted.mediaIds, ...erased.mediaIds, ...still.mediaIds]);
      await seal(tx, sealed.mediaIds);
      await h.setPostState(deleted.postId, "deleted_by_author");
      await tx.execute(sql`update post_media set erased_at = now() where id = ${erased.mediaIds[0]!}::uuid`);
      const opened: (number | null)[] = [];
      for (const image of images) {
        const file = await image.open();
        opened.push(file ? file.size : null);
        await file?.handle.close();
      }
      expect(opened).toEqual([null, null, null, `large-webp-of-${still.mediaIds[0]}`.length]);
      // Another account's id opens nothing through this account's list.
      expect(await h.deps.repo.isExportable((await h.established()).id, still.mediaIds[0]!)).toBe(false);
      expect(await h.deps.repo.isExportable(ada.id, still.mediaIds[0]!)).toBe(true);
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
