import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { LAB_DIR, buildTool, filesUnder, labVolumes, measure, record, removeRun, runTool, sizeOf, writeJob } from "./support";

/**
 * The traversal lab (3b design, 12.5): every crafted name of 12.1 (.., a leading slash, a drive letter, a backslash, a
 * NUL, 513 bytes, an empty and a `.` segment, a media name with .. in it) and symbolic links to /etc/passwd inside the
 * archive, and an archive that is itself a symbolic link to /etc/passwd. Each is refused or ignored, and nothing is
 * written outside jobs/<id>/ of the work volume.
 */

const dir = path.join(LAB_DIR, `traversal-${randomUUID()}`);
const PASSWD = "/etc/passwd";

beforeAll(async () => {
  await buildTool();
  mkdirSync(dir, { recursive: true });
  await runTool(["traversal", dir]);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("crafted names and symbolic links in the archive are ignored; nothing is written outside jobs/<id>/", async () => {
  const volumes = labVolumes();
  const { archives, work, id } = volumes;
  renameSync(path.join(dir, "crafted-names.zip"), archives.archive(id));
  writeJob(volumes, "x", true);
  const archivesBefore = filesUnder(archives.root).sort();
  const bytes = sizeOf(archives.archive(id));
  const result = await measure(volumes);
  record("traversal", "crafted-names.zip", bytes, result);
  try {
    expect(result.summary).toMatchObject({ status: "scanned", posts: 2, images: 0, imagesSkipped: { missing_file: 1 } });
    // The work volume holds the job's two files and the attempt counter, and an empty tmp/.
    expect(filesUnder(work.root).sort()).toEqual(["attempts/", `attempts/${id}`, "jobs/", `jobs/${id}/`, `jobs/${id}/posts.jsonl`, `jobs/${id}/summary.json`, "tmp/"].sort());
    // The archives volume is as the API left it (the importer mounts it read-only).
    expect(filesUnder(archives.root).sort()).toEqual(archivesBefore);
    // No file anywhere on either volume holds what a followed link would have copied.
    const secret = existsSync(PASSWD) ? readFileSync(PASSWD, "utf8").split(String.fromCharCode(10))[0]! : "root:x:0:0";
    for (const file of filesUnder(volumes.root).filter((name) => !name.endsWith("/"))) {
      const full = path.join(volumes.root, file);
      if (statSync(full).size < 64 * 1_048_576) expect(readFileSync(full, "utf8").includes(secret), file).toBe(false);
    }
    for (const outside of ["/tmp/evil.txt", "/etc/cron.d/evil", path.join(LAB_DIR, "evil.txt"), path.join(work.root, "evil")]) expect(existsSync(outside), outside).toBe(false);
  } finally {
    removeRun(volumes);
  }
});

test("an archive that is a symbolic link to /etc/passwd is refused without being read", async (context) => {
  const volumes = labVolumes();
  try {
    symlinkSync(PASSWD, volumes.archives.archive(volumes.id));
  } catch (err) {
    // Without the right to make symbolic links (Windows without Developer Mode) there is nothing to test.
    removeRun(volumes);
    if ((err as NodeJS.ErrnoException).code === "EPERM" && process.platform === "win32") return context.skip();
    throw err;
  }
  writeJob(volumes, "x", false);
  const result = await measure(volumes);
  record("traversal", "archive-symlink", 0, result);
  removeRun(volumes);
  expect(result.summary).toEqual({ v: 1, id: volumes.id, status: "failed", failure: "unreadable" });
});
