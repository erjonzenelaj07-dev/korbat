import path from "node:path";
import { describe, expect, test } from "vitest";
import { archivesLayout, isImportId, isImportMediaFile, mediaFileName, workLayout } from "../src/index";

const ID = "3f2a9c1e-8b7d-4e6f-a5c4-0123456789ab";
/** Built by code: this file holds no backslash. */
const BACKSLASH = String.fromCharCode(92);

describe("ids", () => {
  test("only a lowercase UUID is an import id", () => {
    expect(isImportId(ID)).toBe(true);
    const refused = [
      "",
      ID.toUpperCase(),
      `${ID.slice(0, -1)}B`,
      `${ID}.json`,
      `../${ID}`,
      `${ID}/..`,
      `${ID}/x`,
      `${ID}${BACKSLASH}x`,
      `x${BACKSLASH}${ID}`,
      "..",
      ".",
      "heartbeat",
      `${ID} `,
      ` ${ID}`,
      ID.replace(/-/g, ""),
      ID.replace("-", "_"),
      `{${ID}}`,
    ];
    for (const value of refused) expect(isImportId(value), JSON.stringify(value)).toBe(false);
  });

  test("only <ref>-<position>.<jpg|png|webp> names an image of the work folder", () => {
    for (const name of ["0-0.jpg", "12-3.png", "49999-1.webp"]) expect(isImportMediaFile(name), name).toBe(true);
    const refused = ["0-4.jpg", "0-5.png", "50000-0.jpg", "..", "../0-0.jpg", "0-0.jpg/..", "a/0-0.jpg", `a${BACKSLASH}0-0.jpg`, `0-0.jpg${BACKSLASH}`, "0-0.JPG", "0-0.gif", "0-0", "", "heartbeat"];
    for (const name of refused) expect(isImportMediaFile(name), JSON.stringify(name)).toBe(false);
  });

  test("mediaFileName makes the names the core writes, and nothing else", () => {
    expect(mediaFileName(0, 0, "jpg")).toBe("0-0.jpg");
    expect(mediaFileName(49_999, 3, "webp")).toBe("49999-3.webp");
    expect(() => mediaFileName(0, 4, "jpg")).toThrow();
    expect(() => mediaFileName(-1, 0, "jpg")).toThrow();
    expect(() => mediaFileName(50_000, 0, "png")).toThrow();
    expect(() => mediaFileName(1.5, 0, "png")).toThrow();
    expect(() => mediaFileName(0, 0, "gif" as "jpg")).toThrow();
  });
});

describe("the archives volume (the API writes, the importer reads)", () => {
  test("its tree", () => {
    const archives = archivesLayout(path.join("x", "archives"));
    const at = (...parts: string[]) => path.join("x", "archives", ...parts);
    expect(archives.root).toBe(at());
    expect([archives.jobs, archives.queue, archives.deletions]).toEqual([at("jobs"), at("queue"), at("delete")]);
    expect(archives.jobDir(ID)).toBe(at("jobs", ID));
    expect(archives.part(ID)).toBe(at("jobs", ID, "archive.part"));
    expect(archives.archive(ID)).toBe(at("jobs", ID, "archive"));
    expect(archives.job(ID)).toBe(at("jobs", ID, "job.json"));
    expect(archives.queued(ID)).toBe(at("queue", ID));
    expect(archives.deletion(ID)).toBe(at("delete", ID));
  });

  test("nothing but an import id becomes part of a path", () => {
    const archives = archivesLayout("a");
    for (const bad of [ID.toUpperCase(), "..", `../${ID}`, `${ID}${BACKSLASH}..`, ""]) {
      for (const build of [archives.jobDir, archives.part, archives.archive, archives.job, archives.queued, archives.deletion]) expect(() => build(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("the work volume (the importer writes, the API reads)", () => {
  test("its tree", () => {
    const work = workLayout(path.join("x", "work"));
    const at = (...parts: string[]) => path.join("x", "work", ...parts);
    expect(work.root).toBe(at());
    expect([work.jobs, work.attempts, work.tmp, work.heartbeat]).toEqual([at("jobs"), at("attempts"), at("tmp"), at("heartbeat")]);
    expect(work.jobDir(ID)).toBe(at("jobs", ID));
    expect(work.scratch(ID)).toBe(at("jobs", ID, "scratch"));
    expect(work.posts(ID)).toBe(at("jobs", ID, "posts.jsonl"));
    expect(work.mediaDir(ID)).toBe(at("jobs", ID, "media"));
    expect(work.media(ID, "3-1.png")).toBe(at("jobs", ID, "media", "3-1.png"));
    expect(work.summary(ID)).toBe(at("jobs", ID, "summary.json"));
    expect(work.attempt(ID)).toBe(at("attempts", ID));
  });

  test("ids and media names are checked before any path is built", () => {
    const work = workLayout("w");
    for (const bad of [ID.toUpperCase(), "..", `${ID}/x`, `${ID}${BACKSLASH}x`, ""]) {
      for (const build of [work.jobDir, work.scratch, work.posts, work.mediaDir, work.summary, work.attempt]) expect(() => build(bad), JSON.stringify(bad)).toThrow();
      expect(() => work.media(bad, "0-0.jpg")).toThrow();
    }
    for (const name of ["0-4.jpg", "..", "../summary.json", `..${BACKSLASH}0-0.jpg`, "0-0.jpg/x", "summary.json"]) expect(() => work.media(ID, name), name).toThrow();
  });
});
