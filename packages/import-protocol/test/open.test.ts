import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { openWorkFile, readSummary, workLayout } from "../src/index";

/**
 * The API's one opener (3b design, section 7.1): every file of import-work the API reads is opened through it, since the
 * importer that wrote the volume parses hostile input. On Windows a directory junction stands in for a symlinked folder:
 * it needs no privilege, and lstat reports it as a symbolic link, as a plain directory link on Linux.
 */
const base = mkdtempSync(path.join(tmpdir(), "korbat-import-open-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** A fresh work volume holding one job's posts.jsonl, and a folder outside it with a file of the same name. */
function planted() {
  const dir = path.join(base, randomUUID());
  const work = workLayout(path.join(dir, "work"));
  const id = randomUUID();
  mkdirSync(work.mediaDir(id), { recursive: true });
  writeFileSync(work.posts(id), "hello");
  const outside = path.join(dir, "outside");
  mkdirSync(path.join(outside, "media"), { recursive: true });
  writeFileSync(path.join(outside, "posts.jsonl"), "SECRET=1");
  writeFileSync(path.join(outside, "summary.json"), "{}");
  writeFileSync(path.join(outside, "media", "0-0.jpg"), "SECRET=1");
  return { work, id, outside };
}

/** Plants a link to a folder: a junction on Windows, a symlink elsewhere. */
function linkFolder(target: string, link: string) {
  symlinkSync(target, link, "junction");
}

describe("openWorkFile", () => {
  test("a plain file is opened and read through its descriptor", async () => {
    const { work, id } = planted();
    const opened = await openWorkFile(work.root, work.posts(id), 5);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      expect(opened.file.size).toBe(5);
      expect(await opened.file.handle.readFile("utf8")).toBe("hello");
    } finally {
      await opened.file.handle.close();
    }
  });

  test("at its cap, and one byte over", async () => {
    const { work, id } = planted();
    const atCap = await openWorkFile(work.root, work.posts(id), 5);
    if (atCap.ok) await atCap.file.handle.close();
    expect(atCap.ok).toBe(true);
    expect(await openWorkFile(work.root, work.posts(id), 4)).toEqual({ ok: false, code: "too_large" });
  });

  test("a file that is not there, and a path outside the mount", async () => {
    const { work, id, outside } = planted();
    expect(await openWorkFile(work.root, work.summary(id), 100)).toEqual({ ok: false, code: "missing" });
    expect(await openWorkFile(work.root, work.posts(randomUUID()), 100)).toEqual({ ok: false, code: "missing" });
    expect(await openWorkFile(work.root, path.join(outside, "posts.jsonl"), 100)).toEqual({ ok: false, code: "outside" });
    expect(await openWorkFile(work.root, path.join(work.root, "..", "outside", "posts.jsonl"), 100)).toEqual({ ok: false, code: "outside" });
  });

  test("a directory is not a file", async () => {
    const { work, id } = planted();
    expect(await openWorkFile(work.root, work.mediaDir(id), 100)).toEqual({ ok: false, code: "not_a_file" });
    expect(await openWorkFile(work.root, work.jobDir(id), 100)).toEqual({ ok: false, code: "not_a_file" });
    expect(await openWorkFile(work.root, work.root, 100)).toEqual({ ok: false, code: "not_a_file" });
    // A file where a folder of the path should be.
    expect(await openWorkFile(work.root, path.join(work.posts(id), "x"), 100)).toEqual({ ok: false, code: "not_a_file" });
  });

  test("a file on another device is refused, through the tests' device seam", async () => {
    const { work, id } = planted();
    expect(await openWorkFile(work.root, work.posts(id), 100, { device: -1 })).toEqual({ ok: false, code: "other_device" });
    const same = await openWorkFile(work.root, work.posts(id), 100, { device: statSync(work.root, { bigint: true }).dev });
    expect(same.ok).toBe(true);
    if (same.ok) await same.file.handle.close();
  });

  test("a symlinked job folder is refused, wherever it leads", async () => {
    const { work, outside } = planted();
    const id = randomUUID();
    linkFolder(outside, work.jobDir(id));
    expect(await openWorkFile(work.root, work.posts(id), 100)).toEqual({ ok: false, code: "symlink" });
    expect(await openWorkFile(work.root, work.summary(id), 100)).toEqual({ ok: false, code: "symlink" });
    expect(await readSummary(work.root, id)).toEqual({ ok: false, code: "symlink" });
  });

  test("a symlinked media folder, and a symlinked jobs folder, are refused", async () => {
    const { work, id, outside } = planted();
    rmSync(work.mediaDir(id), { recursive: true });
    linkFolder(path.join(outside, "media"), work.mediaDir(id));
    expect(await openWorkFile(work.root, work.media(id, "0-0.jpg"), 100)).toEqual({ ok: false, code: "symlink" });

    const other = workLayout(path.join(base, randomUUID(), "work"));
    const elsewhere = path.join(base, randomUUID());
    const otherId = randomUUID();
    mkdirSync(path.join(elsewhere, otherId), { recursive: true });
    writeFileSync(path.join(elsewhere, otherId, "posts.jsonl"), "SECRET=1");
    mkdirSync(other.root, { recursive: true });
    linkFolder(elsewhere, other.jobs);
    expect(await openWorkFile(other.root, other.posts(otherId), 100)).toEqual({ ok: false, code: "symlink" });
  });

  test("a symlink planted in place of a file is refused, even one that stays inside the volume", async (context) => {
    const { work, id, outside } = planted();
    const other = randomUUID();
    mkdirSync(work.jobDir(other), { recursive: true });
    try {
      symlinkSync(path.join(outside, "posts.jsonl"), work.posts(other));
      symlinkSync(work.posts(id), work.summary(other));
    } catch (err) {
      // Windows without Developer Mode cannot make a file symlink: the folder cases above stand for it there.
      if ((err as NodeJS.ErrnoException).code === "EPERM" && process.platform === "win32") return context.skip();
      throw err;
    }
    expect(await openWorkFile(work.root, work.posts(other), 100)).toEqual({ ok: false, code: "symlink" });
    expect(await openWorkFile(work.root, work.summary(other), 100)).toEqual({ ok: false, code: "symlink" });
  });

  test.skipIf(process.platform === "win32")("a FIFO is refused at once instead of blocking a thread", { timeout: 5_000 }, async () => {
    const { work, id } = planted();
    execFileSync("mkfifo", [work.summary(id)]);
    expect(await openWorkFile(work.root, work.summary(id), 100)).toEqual({ ok: false, code: "not_a_file" });
  });
});
