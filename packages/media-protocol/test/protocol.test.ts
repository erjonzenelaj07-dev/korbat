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
  ResultFile,
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
    expect(ResultFile.safeParse({ ...ready, v: 2 }).success).toBe(false);
    expect(ResultFile.safeParse({ ...ready, path: "/etc/passwd" }).success).toBe(false);
    expect(ResultFile.safeParse({ ...ready, id: "../x" }).success).toBe(false);
    expect(ResultFile.safeParse("ready").success).toBe(false);
  });

  test("the heartbeat is a version and a time", () => {
    expect(Heartbeat.parse({ v: 1, at: 1_789_000_000_000 })).toEqual({ v: 1, at: 1_789_000_000_000 });
    expect(Heartbeat.safeParse({ v: 1, at: -1 }).success).toBe(false);
    expect(Heartbeat.safeParse({ v: 1, at: 1, extra: true }).success).toBe(false);
  });
});
