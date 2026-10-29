import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PostView, mediaPath } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { mediaForPosts } from "../../src/media";
import { serve } from "../../src/media/flows/serve";
import { upload } from "../../src/media/flows/upload";
import { setFollow } from "../../src/social/flows/graph";
import { createPost, deletePost, getPost, thread } from "../../src/social/flows/posts";
import { followingTimeline, latestTimeline, profilePosts } from "../../src/social/flows/timelines";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

describe.skipIf(!process.env.INTEGRATION)("integration: images on posts", () => {
  let db: Db;
  let m: MediaHarness;
  let s: SocialHarness;

  beforeAll(async () => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    m = await mediaHarness(db);
    s = socialHarness(db, {
      // 2d Task 3: the media module's interface for posts as createMedia builds it, avatars included.
      media: mediaForPosts(m.deps),
    });
  });
  afterAll(async () => {
    m.cleanup();
    await closeDb(db);
  });

  const image = (id: string, alt: string) => ({ id, alt });
  const page = { limit: 50 };

  test("a post carries its images in order, with sizes, a placeholder, a description and both paths", async () => {
    const ada = await s.established();
    const [first, second] = [await m.readyImage(ada.id, { width: 1600, height: 1200 }), await m.readyImage(ada.id, { width: 900, height: 1600 })];
    const post = PostView.parse(await createPost(s.deps, ada.id, { body: "two photos", media: [image(first, "a harbour at dawn"), image(second, "a lighthouse")] }));
    expect(post.media).toEqual([
      { id: first, width: 1600, height: 1200, blurhash: "L2Eo_P_3jb_3~qoL", alt: "a harbour at dawn", small: mediaPath(first, "small"), large: mediaPath(first, "large") },
      { id: second, width: 900, height: 1600, blurhash: "L2Eo_P_3jb_3~qoL", alt: "a lighthouse", small: mediaPath(second, "small"), large: mediaPath(second, "large") },
    ]);
    expect((await m.deps.repo.find(first))?.postId).toBe(post.id);
    expect((await getPost(s.deps, null, post.id)).media.map((item) => item.id)).toEqual([first, second]);
  });

  test("a post may consist of images only, and replies and quotes carry images too", async () => {
    const ada = await s.established();
    const root = await createPost(s.deps, ada.id, { body: "", media: [image(await m.readyImage(ada.id), "only an image")] });
    expect(root).toMatchObject({ body: "", media: [{ alt: "only an image" }] });
    const reply = await createPost(s.deps, ada.id, { body: "and one more", replyToId: root.id, media: [image(await m.readyImage(ada.id), "a reply image")] });
    const quote = await createPost(s.deps, ada.id, { body: "look at this", quoteOfId: root.id, media: [] });
    expect(reply.media).toHaveLength(1);
    expect(quote.quoteOf).toMatchObject({ id: root.id, media: [{ alt: "only an image" }] });
    const opened = await thread(s.deps, null, reply.id, page);
    expect(opened.ancestors[0]).toMatchObject({ id: root.id, media: [{ alt: "only an image" }] });
    expect((await thread(s.deps, null, root.id, page)).replies.items[0]).toMatchObject({ id: reply.id, media: [{ alt: "a reply image" }] });
  });

  test("only your own ready image that is on no post can be attached, and a refused image means no post", async () => {
    const [ada, bob] = await Promise.all([s.established(), s.established()]);
    const bobs = await m.readyImage(bob.id);
    const processing = (await upload(m.deps, ada.id, m.jpeg())).id;
    const used = await m.readyImage(ada.id);
    await createPost(s.deps, ada.id, { body: "first use", media: [image(used, "used once")] });
    const before = (await profilePosts(s.deps, null, ada.handle, page)).items.length;

    for (const id of [bobs, processing, used, m.newId()]) {
      expect(await rejection(createPost(s.deps, ada.id, { body: "should not exist", media: [image(id, "x")] })), id).toBe("media_unavailable");
    }
    const good = await m.readyImage(ada.id);
    expect(await rejection(createPost(s.deps, ada.id, { body: "half good", media: [image(good, "fine"), image(bobs, "not mine")] }))).toBe("media_unavailable");
    expect((await m.deps.repo.find(good))?.postId).toBeNull();
    expect((await profilePosts(s.deps, null, ada.handle, page)).items.length).toBe(before);
    expect((await createPost(s.deps, ada.id, { body: "now it works", media: [image(good, "fine")] })).media).toHaveLength(1);
  });

  test("timelines, profiles and threads all carry images, and reposts show the original's", async () => {
    const [viewer, ada] = await Promise.all([s.established(), s.established()]);
    await setFollow(s.deps, viewer.id, ada.handle, true);
    const post = await createPost(s.deps, ada.id, { body: "in every list", media: [image(await m.readyImage(ada.id), "a list image")] });
    const expected = [{ alt: "a list image" }];
    expect((await followingTimeline(s.deps, viewer.id, page)).items.find((item) => item.post.id === post.id)?.post.media).toMatchObject(expected);
    expect((await latestTimeline(s.deps, null, page)).items.find((item) => item.post.id === post.id)?.post.media).toMatchObject(expected);
    expect((await profilePosts(s.deps, null, ada.handle, page)).items.find((item) => item.post.id === post.id)?.post.media).toMatchObject(expected);
    const plain = await createPost(s.deps, ada.id, { body: "no images here", media: [] });
    expect(plain.media).toEqual([]);
  });

  test("deleting a post removes its image rows, asks for the files to be deleted, and the files stop being served at once", async () => {
    const ada = await s.established();
    const ids = [await m.readyImage(ada.id), await m.readyImage(ada.id)];
    const post = await createPost(s.deps, ada.id, { body: "short lived", media: ids.map((id) => image(id, "soon gone")) });
    const asked = () => serve(m.deps, { id: ids[0]!, size: "large", ifNoneMatch: undefined, viewer: async () => ada.id });
    const served = await asked();
    expect(served.kind).toBe("file");
    if (served.kind === "file") await served.file.handle.close();

    await deletePost(s.deps, ada.id, post.id);
    expect(await m.deps.repo.find(ids[0]!)).toBeNull();
    expect(await m.deps.repo.find(ids[1]!)).toBeNull();
    expect((await m.files.deletionRequests()).sort()).toEqual(expect.arrayContaining([...ids].sort()));
    expect((await asked()).kind).toBe("not_found");
    expect(await rejection(getPost(s.deps, ada.id, post.id))).toBe("not_found");
  });

  test("without a media module posts carry no images and attaching one is refused", async () => {
    const plain = socialHarness(db);
    const ada = await plain.established();
    expect((await createPost(plain.deps, ada.id, { body: "text only", media: [] })).media).toEqual([]);
    expect(await rejection(createPost(plain.deps, ada.id, { body: "with an image", media: [image(m.newId(), "x")] }))).toBe("media_unavailable");
  });
});
