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
      r1Classifier: "off",
    });
  });

  test("3d Task 6: the R1 scorer is off unless set; test only on a closed site; onnx is no adapter of this build", () => {
    expect(loadConfig({ ...base, R1_CLASSIFIER: "" }).r1Classifier).toBe("off");
    expect(loadConfig({ ...base, R1_CLASSIFIER: "test", APP_SITE: "closed" }).r1Classifier).toBe("test");
    expect(() => loadConfig({ ...base, R1_CLASSIFIER: "test" })).toThrow(/R1_CLASSIFIER=test is refused while APP_SITE is open/);
    expect(() => loadConfig({ ...base, R1_CLASSIFIER: "test", APP_SITE: "open" })).toThrow(/R1_CLASSIFIER=test is refused while APP_SITE is open/);
    // In production too: the refusal holds in every environment.
    expect(() => loadConfig({ ...base, NODE_ENV: "production", VIPS_BLOCK_UNTRUSTED: "1", R1_CLASSIFIER: "test" })).toThrow(/APP_SITE is open/);
    expect(() => loadConfig({ ...base, R1_CLASSIFIER: "onnx", APP_SITE: "closed" })).toThrow(/no such adapter in this build/);
    expect(() => loadConfig({ ...base, R1_CLASSIFIER: "clip" })).toThrow(/R1_CLASSIFIER/);
    expect(() => loadConfig({ ...base, APP_SITE: "ajar" })).toThrow(/APP_SITE/);
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
