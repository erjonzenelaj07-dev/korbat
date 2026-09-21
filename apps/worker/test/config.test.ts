import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config";

const base = { MEDIA_UPLOADS_DIR: "/media/uploads", MEDIA_STORE_DIR: "/media/store" };

describe("worker configuration", () => {
  test("two directories are all it needs; every format is enabled by default", () => {
    expect(loadConfig(base)).toEqual({
      production: false,
      logLevel: "info",
      uploadsDir: "/media/uploads",
      storeDir: "/media/store",
      formats: ["jpeg", "png", "webp", "gif", "avif"],
    });
  });

  test("MEDIA_FORMATS enables a subset, and a typo stops the process", () => {
    expect(loadConfig({ ...base, MEDIA_FORMATS: "jpeg,png" }).formats).toEqual(["jpeg", "png"]);
    expect(() => loadConfig({ ...base, MEDIA_FORMATS: "jpeg,heic" })).toThrow(/unknown formats: heic/);
  });

  test("a missing directory is named", () => {
    expect(() => loadConfig({ MEDIA_UPLOADS_DIR: "/media/uploads" })).toThrow(/MEDIA_STORE_DIR/);
    expect(() => loadConfig({ MEDIA_STORE_DIR: "/media/store" })).toThrow(/MEDIA_UPLOADS_DIR/);
  });

  test("production refuses to start unless libvips was told to block untrusted loaders", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/VIPS_BLOCK_UNTRUSTED/);
    expect(loadConfig({ ...base, NODE_ENV: "production", VIPS_BLOCK_UNTRUSTED: "1" }).production).toBe(true);
  });
});
