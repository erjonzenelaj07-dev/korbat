import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LAB_DIR, buildTool, labVolumes, measure, record, removeRun, runTool, sizeOf, writeJob } from "./support";

/**
 * The zip-bomb lab (3b design, 12.5): the overlapping-files bomb (a 10 MB file declaring terabytes, and the same
 * overlap within every per-entry limit), a ratio bomb within one entry, a central directory of 1,000,000 entries, and
 * ZIP64 records that lie about sizes and offsets. Each is refused within 5 seconds and under 64 MB of memory.
 */

const MB = 1_048_576;
const bombs = path.join(LAB_DIR, `zip-bombs-${randomUUID()}`);

beforeAll(async () => {
  await buildTool();
  mkdirSync(bombs, { recursive: true });
  await runTool(["zip-bombs", bombs]);
});

afterAll(() => rmSync(bombs, { recursive: true, force: true }));

const cases: [string, string][] = [
  ["overlap-terabytes.zip", "too_large_uncompressed"],
  ["overlap-within-limits.zip", "unreadable"],
  ["ratio-bomb.zip", "unreadable"],
  ["million-entries.zip", "too_many_entries"],
  ["zip64-offset-past-end.zip", "unreadable"],
  ["zip64-size-lies.zip", "too_large_uncompressed"],
  ["zip64-entry-offset-lies.zip", "unreadable"],
];

describe.each(cases)("%s", (file, failure) => {
  test(`is refused (${failure}) within 5 seconds and under 64 MB`, async () => {
    const volumes = labVolumes();
    const archive = volumes.archives.archive(volumes.id);
    renameSync(path.join(bombs, file), archive);
    writeJob(volumes, "x", true);
    const bytes = sizeOf(archive);
    const result = await measure(volumes);
    record("zip-bomb", file, bytes, result);
    removeRun(volumes);
    expect(result.summary).toEqual({ v: 1, id: volumes.id, status: "failed", failure });
    expect(result.ms).toBeLessThan(5_000);
    expect(result.peak).toBeLessThan(64 * MB);
  });
});
