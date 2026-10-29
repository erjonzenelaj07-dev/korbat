import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import pino from "pino";
import { afterAll, describe, expect, test } from "vitest";
import { Heartbeat, MEDIA_FORMATS, ResultFile, storeLayout, uploadsLayout } from "@korbat/media-protocol";
import { prepareStore, tick, writeHeartbeat, type LoopDeps } from "../src/loop";
import { processImage, configureDecoder, type Processed } from "../src/pipeline";
import * as make from "./fixtures";

const ws = make.workspace();
afterAll(() => ws.remove());

const READY: Processed = { ok: true, width: 800, height: 600, blurhash: "L2Eo_P_3jb_3", small: Buffer.from("small-bytes"), large: Buffer.from("large-bytes") };

/** Two fresh volumes and a loop around a stand-in pipeline, so these tests are about the protocol only. */
async function harness(process: LoopDeps["process"] = async () => READY) {
  const root = path.join(ws.dir, randomUUID());
  const uploads = uploadsLayout(path.join(root, "uploads"));
  const store = storeLayout(path.join(root, "store"));
  for (const dir of [uploads.tmp, uploads.incoming, uploads.deletions]) mkdirSync(dir, { recursive: true });
  await prepareStore(store);
  const calls: string[] = [];
  // 2d Task 3: the crop each call was given, undefined for a post's upload.
  const crops: (string | undefined)[] = [];
  const aborted: string[] = [];
  let clock = 1_800_000_000_000;
  const deps: LoopDeps = {
    uploads,
    store,
    formats: MEDIA_FORMATS,
    log: pino({ level: "silent" }),
    now: () => (clock += 5),
    process: async (file, formats, avatar) => {
      calls.push(path.basename(file));
      crops.push(avatar?.crop);
      return process(file, formats, avatar);
    },
    abort: (reason) => void aborted.push(reason),
    watchdogMs: 10_000,
  };
  const upload = (data: Buffer | string = "bytes", id: string = randomUUID()) => {
    writeFileSync(uploads.upload(id), data);
    return id;
  };
  const result = (id: string) => ResultFile.parse(JSON.parse(readFileSync(store.result(id), "utf8")));
  /** 2d Task 3: an avatar's job file beside the upload, as the API writes it before the upload. */
  const job = (id: string, text: string) => writeFileSync(uploads.avatarJob(id), text);
  return { deps, uploads, store, upload, job, result, calls, crops, aborted };
}

describe("processing uploads", () => {
  test("an upload becomes two files and a ready result, and the attempt is counted", async () => {
    const h = await harness();
    const id = h.upload();
    expect(await tick(h.deps)).toBe(true);
    // 3d Task 6: without a scorer the result carries no score. 2d Task 3: the worker writes version 3, and a post's upload
    // carries no avatar mark.
    expect(h.result(id)).toEqual({ v: 3, id, status: "ready", width: 800, height: 600, blurhash: "L2Eo_P_3jb_3" });
    expect(h.crops).toEqual([undefined]);
    expect(readFileSync(h.store.image(id, "large"), "utf8")).toBe("large-bytes");
    expect(readFileSync(h.store.image(id, "small"), "utf8")).toBe("small-bytes");
    expect(readFileSync(h.store.attempt(id), "utf8")).toBe("1");
    expect(readdirSync(h.store.tmp)).toEqual([]);
  });

  test("3d Task 6: with a scorer's answer, the ready result carries its model and score, and the log line holds neither", async () => {
    const h = await harness(async () => ({ ...READY, r1: { model: "korbat-test-marker", score: 1 } }));
    const id = h.upload();
    await tick(h.deps);
    expect(h.result(id)).toEqual({ v: 3, id, status: "ready", width: 800, height: 600, blurhash: "L2Eo_P_3jb_3", r1: { model: "korbat-test-marker", score: 1 } });
  });

  test("a refused upload gets a failed result with the reason and no files", async () => {
    const h = await harness(async () => ({ ok: false, reason: "animated_not_supported" }));
    const id = h.upload();
    await tick(h.deps);
    expect(h.result(id)).toEqual({ v: 3, id, status: "failed", reason: "animated_not_supported" });
    expect(existsSync(h.store.imageDir(id))).toBe(false);
  });

  test("an upload with a result is left alone, and an idle tick reports no work", async () => {
    const h = await harness();
    h.upload();
    await tick(h.deps);
    expect(await tick(h.deps)).toBe(false);
    expect(h.calls).toHaveLength(1);
  });

  test("one upload per tick, oldest first", async () => {
    const h = await harness();
    const newer = h.upload("b");
    const older = h.upload("a");
    utimesSync(h.uploads.upload(older), new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    utimesSync(h.uploads.upload(newer), new Date(1_700_000_100_000), new Date(1_700_000_100_000));
    await tick(h.deps);
    expect(h.calls).toEqual([older]);
    await tick(h.deps);
    expect(h.calls).toEqual([older, newer]);
  });

  test("a file that makes processing throw is tried three times and then fails for good", async () => {
    const h = await harness(async () => {
      throw new Error("decoder crashed");
    });
    const id = h.upload();
    for (let i = 0; i < 3; i++) {
      await tick(h.deps);
      expect(existsSync(h.store.result(id))).toBe(false);
    }
    expect(readFileSync(h.store.attempt(id), "utf8")).toBe("3");
    await tick(h.deps);
    expect(h.result(id)).toEqual({ v: 3, id, status: "failed", reason: "processing_failed" });
    expect(h.calls).toHaveLength(3);
  });

  test("the attempt is written before the pipeline runs, so a killed process still counts", async () => {
    let seen = "";
    const h = await harness(async (file) => {
      seen = readFileSync(h.store.attempt(path.basename(file)), "utf8");
      return READY;
    });
    h.upload();
    await tick(h.deps);
    expect(seen).toBe("1");
  });

  test("an unreadable attempt counter counts as used up", async () => {
    const h = await harness();
    const id = h.upload();
    writeFileSync(h.store.attempt(id), "many");
    await tick(h.deps);
    expect(h.result(id)).toMatchObject({ status: "failed", reason: "processing_failed" });
    expect(h.calls).toHaveLength(0);
  });

  test("an upload withdrawn while it was being read leaves nothing behind", async () => {
    const h = await harness(async (file) => {
      const fs = await import("node:fs/promises");
      await fs.rm(file);
      throw new Error("Input file is missing");
    });
    const id = h.upload();
    await tick(h.deps);
    await tick(h.deps);
    expect(existsSync(h.store.result(id))).toBe(false);
    expect(existsSync(h.store.attempt(id))).toBe(false);
    expect(h.calls).toHaveLength(1);
  });

  test("the watchdog ends the process when one upload takes too long", async () => {
    const h = await harness(() => new Promise((resolve) => setTimeout(() => resolve(READY), 120)));
    h.deps.watchdogMs = 30;
    h.upload();
    await tick(h.deps);
    expect(h.aborted).toHaveLength(1);
    expect(h.aborted[0]).toMatch(/took longer than 30 ms/);
  });
});

describe("2d Task 3: an avatar's job file (design, sections 7.2 and 7.4)", () => {
  test("an upload with a job file is processed with its crop, and its ready result is version 3 with the mark", async () => {
    const h = await harness(async () => ({ ...READY, width: 400, height: 400 }));
    const id = randomUUID();
    h.job(id, JSON.stringify({ v: 1, crop: "end" }));
    h.upload("bytes", id);
    expect(await tick(h.deps)).toBe(true);
    expect(h.crops).toEqual(["end"]);
    expect(h.result(id)).toEqual({ v: 3, id, status: "ready", width: 400, height: 400, blurhash: "L2Eo_P_3jb_3", avatar: true });
  });

  test("a refused avatar gets a failed result, which never carries the mark", async () => {
    const h = await harness(async () => ({ ok: false, reason: "corrupt_image" }));
    const id = randomUUID();
    h.job(id, JSON.stringify({ v: 1, crop: "start" }));
    h.upload("bytes", id);
    await tick(h.deps);
    expect(h.result(id)).toEqual({ v: 3, id, status: "failed", reason: "corrupt_image" });
  });

  test("a job file that is not exactly a version and a crop, too long, or not a plain file fails the upload as processing_failed, and the pipeline never runs", async () => {
    const h = await harness();
    const bad = ["not json", "{}", JSON.stringify({ v: 1 }), JSON.stringify({ v: 1, crop: "middle" }), JSON.stringify({ v: 2, crop: "centre" }), JSON.stringify({ v: 1, crop: "centre", size: 400 }), `${JSON.stringify({ v: 1, crop: "centre" })}${" ".repeat(300)}`];
    const ids: string[] = [];
    for (const text of bad) {
      const id = randomUUID();
      h.job(id, text);
      h.upload("bytes", id);
      ids.push(id);
    }
    const folder = randomUUID();
    mkdirSync(h.uploads.avatarJob(folder));
    h.upload("bytes", folder);
    ids.push(folder);
    for (let i = 0; i < ids.length; i++) await tick(h.deps);
    for (const id of ids) expect(h.result(id), id).toEqual({ v: 3, id, status: "failed", reason: "processing_failed" });
    expect(h.calls).toEqual([]);
  });

  test("a job file alone is no upload: the scan of incoming/ skips it, and it is never processed", async () => {
    const h = await harness();
    h.job(randomUUID(), JSON.stringify({ v: 1, crop: "centre" }));
    expect(await tick(h.deps)).toBe(false);
    expect(h.calls).toEqual([]);
  });

  test("with the real pipeline: an avatar's upload ends as its two squares on the store volume", async () => {
    configureDecoder(MEDIA_FORMATS);
    // As the process wires it: the job's crop is processImage's fourth argument, after the scorer (none here).
    const h = await harness((file, formats, avatar) => processImage(file, formats, null, avatar));
    const id = randomUUID();
    h.job(id, JSON.stringify({ v: 1, crop: "centre" }));
    h.upload(await make.jpeg(1200, 900), id);
    await tick(h.deps);
    expect(h.result(id)).toMatchObject({ v: 3, status: "ready", width: 400, height: 400, avatar: true });
    expect(readFileSync(h.store.image(id, "large")).subarray(8, 12).toString("latin1")).toBe("WEBP");
    expect(readFileSync(h.store.image(id, "small")).subarray(8, 12).toString("latin1")).toBe("WEBP");
  });
});

describe("what the loop ignores", () => {
  test("names that are not media ids, directories, and symlinks", async () => {
    const h = await harness();
    writeFileSync(path.join(h.uploads.incoming, "not-an-id"), "x");
    writeFileSync(path.join(h.uploads.incoming, `${randomUUID()}.part`), "x");
    mkdirSync(path.join(h.uploads.incoming, randomUUID()));
    if (process.platform !== "win32") symlinkSync("/etc/passwd", path.join(h.uploads.incoming, randomUUID()));
    expect(await tick(h.deps)).toBe(false);
    expect(h.calls).toEqual([]);
  });
});

describe("deletion requests", () => {
  test("remove the image folder, the result and the attempt counter, and cost nothing when repeated", async () => {
    const h = await harness();
    const id = h.upload();
    await tick(h.deps);
    writeFileSync(h.uploads.deletion(id), "");
    expect(await tick(h.deps)).toBe(true);
    expect([h.store.imageDir(id), h.store.result(id), h.store.attempt(id)].map((target) => existsSync(target))).toEqual([false, false, false]);
    expect(await tick(h.deps)).toBe(false);
  });

  test("an upload with a deletion request is not processed", async () => {
    const h = await harness();
    const id = h.upload();
    writeFileSync(h.uploads.deletion(id), "");
    expect(await tick(h.deps)).toBe(false);
    expect(h.calls).toEqual([]);
  });

  test("files written after the request arrived are still removed", async () => {
    const h = await harness();
    const id = randomUUID();
    writeFileSync(h.uploads.deletion(id), "");
    await tick(h.deps);
    mkdirSync(h.store.imageDir(id), { recursive: true });
    writeFileSync(h.store.image(id, "large"), "late");
    expect(await tick(h.deps)).toBe(true);
    expect(existsSync(h.store.imageDir(id))).toBe(false);
  });
});

describe("results", () => {
  test("a result whose upload is gone has been consumed and is removed with its counter", async () => {
    const h = await harness();
    const id = h.upload();
    await tick(h.deps);
    const fs = await import("node:fs/promises");
    await fs.rm(h.uploads.upload(id));
    await tick(h.deps);
    expect(existsSync(h.store.result(id))).toBe(false);
    expect(existsSync(h.store.attempt(id))).toBe(false);
    expect(existsSync(h.store.image(id, "large"))).toBe(true);
  });
});

describe("heartbeat and start", () => {
  test("the heartbeat is a small file the API can parse", async () => {
    const h = await harness();
    await writeHeartbeat(h.deps);
    expect(Heartbeat.parse(JSON.parse(readFileSync(h.store.heartbeat, "utf8")))).toMatchObject({ v: 1 });
  });

  test("starting clears half-written files and keeps finished ones", async () => {
    const h = await harness();
    const id = h.upload();
    await tick(h.deps);
    writeFileSync(path.join(h.store.tmp, "half-written"), "x");
    await prepareStore(h.store);
    expect(readdirSync(h.store.tmp)).toEqual([]);
    expect(existsSync(h.store.image(id, "small"))).toBe(true);
  });
});

describe("with the real pipeline", () => {
  test("a JPEG upload ends as WebP files on the store volume", async () => {
    configureDecoder(MEDIA_FORMATS);
    const h = await harness((file, formats) => processImage(file, formats));
    const id = h.upload(await make.photoWithMetadata());
    const refused = h.upload(make.svg());
    await tick(h.deps);
    await tick(h.deps);
    expect(h.result(id)).toMatchObject({ status: "ready", width: 200, height: 400 });
    expect(readFileSync(h.store.image(id, "large")).subarray(8, 12).toString("latin1")).toBe("WEBP");
    expect(readFileSync(h.store.image(id, "large")).includes(make.SECRET)).toBe(false);
    expect(h.result(refused)).toMatchObject({ status: "failed", reason: "unsupported_format" });
  });
});
