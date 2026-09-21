import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import pino from "pino";
import { postMedia, posts, type Db } from "@korbat/db";
import type { MediaFailure } from "@korbat/contracts";
import { MEDIA_FORMATS, storeLayout, type MediaFormat, type StoreLayout } from "@korbat/media-protocol";
import type { MediaDeps } from "../../src/media/context";
import { createMediaFiles } from "../../src/media/files";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { createMediaRepo } from "../../src/media/repo";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { enforceWriteLimit } from "../../src/social/limits";
import { createSocialRepo } from "../../src/social/repo";
import { DAY_MS, HOUR_MS } from "../../src/social/tiers";
import { newPost, newProfile, ticker } from "./social-fixtures";

/** The first bytes of each kind of file. The API judges an upload by these and never decodes it. */
export const BYTES = {
  jpeg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("JFIF-test-image")]),
  png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-test-image")]),
  pdf: Buffer.from("%PDF-1.7 not an image"),
  heic: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.from([0, 0, 0, 0]), Buffer.from("mif1heic")]),
  animatedWebp: Buffer.concat([Buffer.from("RIFF"), Buffer.from([40, 0, 0, 0]), Buffer.from("WEBPVP8X"), Buffer.from([10, 0, 0, 0, 0x02, 0, 0, 0])]),
};

/** A request body that arrives in chunks and declares no length. */
export function bodyOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** Stands in for the worker: writes files and results into a store directory exactly as the protocol says, without decoding anything. */
export function fakeWorker(store: StoreLayout | string) {
  const layout = typeof store === "string" ? storeLayout(store) : store;
  for (const dir of [layout.files, layout.results, layout.attempts, layout.tmp]) mkdirSync(dir, { recursive: true });
  return {
    /** What the worker leaves behind for an image it accepted. */
    ready(id: string, size: { width: number; height: number } = { width: 2048, height: 1536 }) {
      mkdirSync(layout.imageDir(id), { recursive: true });
      writeFileSync(layout.image(id, "large"), `large-webp-of-${id}`);
      writeFileSync(layout.image(id, "small"), `small-webp-of-${id}`);
      writeFileSync(layout.result(id), JSON.stringify({ v: 1, id, status: "ready", ...size, blurhash: "L2Eo_P_3jb_3~qoL" }));
    },
    /** What it leaves behind for one it refused. */
    failed(id: string, reason: MediaFailure) {
      writeFileSync(layout.result(id), JSON.stringify({ v: 1, id, status: "failed", reason }));
    },
    /** A heartbeat written at the given time. */
    beat(at: number) {
      writeFileSync(layout.heartbeat, JSON.stringify({ v: 1, at }));
    },
  };
}

/**
 * The media module on real Postgres, with both volumes in a temporary directory and a stand-in for
 * the worker that writes files and results exactly as the protocol says. Nothing here decodes an image.
 */
export async function mediaHarness(db: Db, options: { formats?: readonly MediaFormat[]; minFreeBytes?: number; storeDevice?: number; clockStart?: number } = {}) {
  const clock = ticker(options.clockStart);
  const root = mkdtempSync(path.join(tmpdir(), "korbat-media-"));
  const files = createMediaFiles({ uploadsDir: path.join(root, "uploads"), storeDir: path.join(root, "store"), log: pino({ level: "silent" }), storeDevice: options.storeDevice });
  await files.prepare();

  const limits = new MemoryStore(() => clock.now().getTime());
  const deps: MediaDeps = {
    repo: createMediaRepo(db),
    files,
    formats: options.formats ?? MEDIA_FORMATS,
    minFreeBytes: options.minFreeBytes ?? 0,
    enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(limits, userId, "upload", accountCreatedAt, now),
    log: pino({ level: "silent" }),
    now: clock.next,
  };

  const worker = fakeWorker(files.store);

  /** An image of this account that the worker accepted and the API recorded: ready, on no post yet. */
  async function readyImage(ownerId: string, size?: { width: number; height: number }): Promise<string> {
    const sent = await upload(deps, ownerId, { contentType: "image/jpeg", contentLength: undefined, body: bodyOf(BYTES.jpeg) });
    worker.ready(sent.id, size);
    await status(deps, ownerId, sent.id);
    return sent.id;
  }

  /** A post by this account with ready images on it, written straight to the tables. */
  async function postWithImages(authorId: string, count = 1, body = "a post with images"): Promise<{ postId: string; mediaIds: string[] }> {
    const postId = await newPost(createSocialRepo(db), authorId, clock.next(), body);
    const mediaIds: string[] = [];
    for (let position = 0; position < count; position++) {
      const id = await readyImage(authorId);
      await db.update(postMedia).set({ postId, position, altText: `image ${position + 1}` }).where(eq(postMedia.id, id));
      mediaIds.push(id);
    }
    return { postId, mediaIds };
  }

  const setPostState = (postId: string, state: "visible" | "withheld" | "removed" | "deleted_by_author") => db.update(posts).set({ state }).where(eq(posts.id, postId));

  return {
    deps,
    files,
    clock,
    worker,
    readyImage,
    postWithImages,
    setPostState,
    jpeg: () => ({ contentType: "image/jpeg", contentLength: undefined, body: bodyOf(BYTES.jpeg) }),
    /** An account old enough for the established tier. */
    established: () => newProfile(db, { createdAt: new Date(clock.now().getTime() - 3 * DAY_MS) }),
    /** An account in its first day. */
    fresh: () => newProfile(db, { createdAt: new Date(clock.now().getTime() - HOUR_MS) }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    newId: randomUUID,
  };
}

export type MediaHarness = Awaited<ReturnType<typeof mediaHarness>>;
