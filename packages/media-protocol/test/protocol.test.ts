import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STALE_MS,
  Heartbeat,
  MAX_ATTEMPTS,
  MAX_SIDE,
  MEDIA_FORMATS,
  PIXEL_CAP,
  R1_MARKER,
  R1_MODEL,
  R1_MODEL_NAME,
  R1_TEST_MODEL,
  RESULT_VERSION,
  ResultFile,
  carriesR1Marker,
  VARIANTS,
  isMediaId,
  parseFormats,
  resultFileId,
  storeLayout,
  uploadsLayout,
} from "../src/index";

const ID = "3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab";

describe("limits", () => {
  test("pixel caps follow what decoding costs: AVIF has its own", () => {
    expect(PIXEL_CAP).toEqual({ jpeg: 50_000_000, png: 50_000_000, webp: 50_000_000, gif: 50_000_000, avif: 16_000_000 });
    expect(MAX_SIDE).toBe(16_383);
    expect(VARIANTS).toEqual({ large: { edge: 2048, quality: 82 }, small: { edge: 1024, quality: 80 } });
    expect(MAX_ATTEMPTS).toBe(3);
    expect(HEARTBEAT_STALE_MS).toBeGreaterThan(HEARTBEAT_INTERVAL_MS * 3);
  });

  test("MEDIA_FORMATS: unset means all, a subset keeps the canonical order", () => {
    expect(parseFormats(undefined)).toEqual([...MEDIA_FORMATS]);
    expect(parseFormats("webp, JPEG")).toEqual(["jpeg", "webp"]);
    expect(parseFormats("jpeg,png,webp,gif")).toEqual(["jpeg", "png", "webp", "gif"]);
    expect(parseFormats("png,png")).toEqual(["png"]);
  });

  test("MEDIA_FORMATS: a typo or an empty entry stops the process instead of silently changing what is accepted", () => {
    expect(() => parseFormats("jpeg,tiff")).toThrow(/unknown formats: tiff/);
    expect(() => parseFormats("")).toThrow(/at least one format/);
    expect(() => parseFormats("jpeg,,png")).toThrow(/no empty entries/);
  });
});

describe("layout", () => {
  test("only lowercase UUIDs are media ids", () => {
    expect(isMediaId(ID)).toBe(true);
    for (const bad of ["", ID.toUpperCase(), `${ID}.json`, `../${ID}`, `${ID}/..`, "..", "heartbeat", `${ID} `, ID.replace("-", "_")]) expect(isMediaId(bad)).toBe(false);
  });

  test("the uploads volume", () => {
    const up = uploadsLayout(path.join("x", "uploads"));
    expect(up.part(ID)).toBe(path.join("x", "uploads", "tmp", `${ID}.part`));
    expect(up.upload(ID)).toBe(path.join("x", "uploads", "incoming", ID));
    expect(up.deletion(ID)).toBe(path.join("x", "uploads", "delete", ID));
    expect([up.tmp, up.incoming, up.deletions]).toEqual(["tmp", "incoming", "delete"].map((name) => path.join("x", "uploads", name)));
    // A deletion that is owed is no request: its marker lies beside the requests, in a directory the worker never reads.
    expect(up.owed).toBe(path.join("x", "uploads", "delete-owed"));
    expect(up.owedDeletion(ID)).toBe(path.join("x", "uploads", "delete-owed", ID));
  });

  test("the store volume shards image folders by the id's first two characters", () => {
    const store = storeLayout(path.join("x", "store"));
    expect(store.shard(ID)).toBe(path.join("x", "store", "files", "3f"));
    expect(store.imageDir(ID)).toBe(path.join("x", "store", "files", "3f", ID));
    expect(store.image(ID, "large")).toBe(path.join("x", "store", "files", "3f", ID, "large.webp"));
    expect(store.image(ID, "small")).toBe(path.join("x", "store", "files", "3f", ID, "small.webp"));
    expect(store.result(ID)).toBe(path.join("x", "store", "results", `${ID}.json`));
    expect(store.attempt(ID)).toBe(path.join("x", "store", "attempts", ID));
    expect(store.heartbeat).toBe(path.join("x", "store", "heartbeat"));
  });

  test("nothing but a media id can become part of a path", () => {
    const up = uploadsLayout("u");
    const store = storeLayout("s");
    for (const bad of ["../../etc/passwd", "..", "", ID.toUpperCase(), `${ID}/x`]) {
      for (const make of [up.part, up.upload, up.deletion, up.owedDeletion, store.shard, store.imageDir, store.result, store.attempt]) expect(() => make(bad)).toThrow("not a media id");
      expect(() => store.image(bad, "large")).toThrow("not a media id");
    }
  });

  test("result file names map back to ids", () => {
    expect(resultFileId(`${ID}.json`)).toBe(ID);
    for (const bad of [ID, `${ID}.json.tmp`, "x.json", `${ID.toUpperCase()}.json`, ".json"]) expect(resultFileId(bad)).toBeNull();
  });
});

describe("result and heartbeat files", () => {
  const ready = { v: 1, id: ID, status: "ready", width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3~qoLfQj]" };

  test("a ready result has the large size's dimensions and a blurhash", () => {
    expect(ResultFile.parse(ready)).toEqual(ready);
    expect(ResultFile.safeParse({ ...ready, width: MAX_SIDE + 1 }).success).toBe(false);
    expect(ResultFile.safeParse({ ...ready, width: 0 }).success).toBe(false);
    expect(ResultFile.safeParse({ ...ready, blurhash: "x" }).success).toBe(false);
    expect(ResultFile.safeParse({ ...ready, blurhash: "x".repeat(65) }).success).toBe(false);
  });

  test("a failed result names one of the known reasons", () => {
    expect(ResultFile.safeParse({ v: 1, id: ID, status: "failed", reason: "animated_not_supported" }).success).toBe(true);
    expect(ResultFile.safeParse({ v: 1, id: ID, status: "failed", reason: "because" }).success).toBe(false);
    expect(ResultFile.safeParse({ v: 1, id: ID, status: "failed" }).success).toBe(false);
  });

  test("results are parsed strictly: no other version, no extra keys, no other id shape", () => {
    expect(ResultFile.safeParse({ ...ready, v: 3 }).success).toBe(false);
    expect(ResultFile.safeParse({ ...ready, v: 0 }).success).toBe(false);
    expect(ResultFile.safeParse({ ...ready, path: "/etc/passwd" }).success).toBe(false);
    expect(ResultFile.safeParse({ ...ready, id: "../x" }).success).toBe(false);
    expect(ResultFile.safeParse("ready").success).toBe(false);
  });

  test("3d Task 6: version 2 is version 1 with v 2 and, on a ready result, the scorer's model and score and the PDQ hash", () => {
    const v2 = { ...ready, v: 2 };
    expect(RESULT_VERSION).toBe(2);
    expect(ResultFile.parse(v2)).toEqual(v2);
    const scored = { ...v2, r1: { model: R1_TEST_MODEL, score: 1 }, pdq: { impl: 1, hash: "ab".repeat(32), quality: 100 } };
    expect(ResultFile.parse(scored)).toEqual(scored);
    expect(ResultFile.parse({ ...v2, r1: { model: R1_MODEL.name, score: 0 } }).v).toBe(2);
    expect(ResultFile.safeParse({ v: 2, id: ID, status: "failed", reason: "corrupt_image" }).success).toBe(true);
    // Version 1 as it stood takes neither member; a failed result of either version takes none.
    expect(ResultFile.safeParse({ ...ready, r1: { model: R1_TEST_MODEL, score: 1 } }).success).toBe(false);
    expect(ResultFile.safeParse({ v: 2, id: ID, status: "failed", reason: "corrupt_image", r1: { model: R1_TEST_MODEL, score: 1 } }).success).toBe(false);
    // Every range and member is held: a score outside 0 to 1, a model's name of other characters or too long, a hash that is
    // not 64 lower-case hex characters, a quality outside 0 to 100, a member more.
    for (const r1 of [{ model: R1_TEST_MODEL, score: 1.5 }, { model: R1_TEST_MODEL, score: -0.1 }, { model: "Model", score: 0 }, { model: "m".repeat(65), score: 0 }, { model: "a b", score: 0 }, { model: R1_TEST_MODEL, score: 0, extra: 1 }]) {
      expect(ResultFile.safeParse({ ...v2, r1 }).success, JSON.stringify(r1)).toBe(false);
    }
    for (const pdq of [{ impl: 0, hash: "ab".repeat(32), quality: 50 }, { impl: 1, hash: "AB".repeat(32), quality: 50 }, { impl: 1, hash: "ab".repeat(31), quality: 50 }, { impl: 1, hash: "ab".repeat(32), quality: 101 }]) {
      expect(ResultFile.safeParse({ ...v2, pdq }).success, JSON.stringify(pdq)).toBe(false);
    }
    expect(ResultFile.safeParse({ ...v2, score: 0.9 }).success).toBe(false);
  });

  test("3d Task 6: the classifier's identity is the research's model, whose weights no build of 3d carries", () => {
    expect(R1_MODEL).toEqual({ name: "marqo/nsfw-image-detection-384", bytes: 22_450_955, sha256: null });
    expect(R1_MODEL_NAME.test(R1_MODEL.name)).toBe(true);
    expect(R1_MODEL_NAME.test(R1_TEST_MODEL)).toBe(true);
    expect(R1_TEST_MODEL).not.toBe(R1_MODEL.name);
  });

  test("3d Task 6: the test scorer's marker is a block of one colour in the top left corner, read within its tolerance", () => {
    expect(R1_MARKER.side).toBeGreaterThanOrEqual(64);
    const image = (width: number, height: number, corner: [number, number, number], channels = 3) => {
      const pixels = new Uint8Array(width * height * channels).fill(40);
      for (let y = 0; y < R1_MARKER.side && y < height; y++) {
        for (let x = 0; x < R1_MARKER.side && x < width; x++) pixels.set(corner, (y * width + x) * channels);
      }
      return pixels;
    };
    const magenta: [number, number, number] = [R1_MARKER.red, R1_MARKER.green, R1_MARKER.blue];
    expect(carriesR1Marker(image(200, 100, magenta), 200, 100, 3)).toBe(true);
    expect(carriesR1Marker(image(200, 100, magenta, 4), 200, 100, 4)).toBe(true);
    // A lossy source's few levels of noise pass; another colour, or a corner without the block, does not.
    expect(carriesR1Marker(image(200, 100, [250, 6, 249]), 200, 100, 3)).toBe(true);
    expect(carriesR1Marker(image(200, 100, [200, 30, 30]), 200, 100, 3)).toBe(false);
    expect(carriesR1Marker(new Uint8Array(200 * 100 * 3).fill(40), 200, 100, 3)).toBe(false);
    // An image smaller than the probe, a grey image and a buffer too short carry none.
    expect(carriesR1Marker(image(8, 8, magenta), 8, 8, 3)).toBe(false);
    expect(carriesR1Marker(image(200, 100, magenta, 1), 200, 100, 1)).toBe(false);
    expect(carriesR1Marker(new Uint8Array(10), 200, 100, 3)).toBe(false);
  });

  test("the heartbeat is a version and a time", () => {
    expect(Heartbeat.parse({ v: 1, at: 1_789_000_000_000 })).toEqual({ v: 1, at: 1_789_000_000_000 });
    expect(Heartbeat.safeParse({ v: 1, at: -1 }).success).toBe(false);
    expect(Heartbeat.safeParse({ v: 1, at: 1, extra: true }).success).toBe(false);
  });
});
