import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LAB_DIR, buildTool, labVolumes, measure, record, removeRun, runTool, sizeOf, writeJob } from "./support";

/**
 * The JSON-bomb lab (3b design, 12.5): one 900 MB string, a depth of 1,000,000 brackets and a key of 500 MB in X's
 * tweets.js, each after one ordinary tweet. Each is refused item_too_large within 5 seconds and under 64 MB of memory;
 * the tweet before it is kept, and the rest of the file is not read (the assembler cannot resume after an element it
 * did not hold).
 */

const MB = 1_048_576;
const bombs = path.join(LAB_DIR, `json-bombs-${randomUUID()}`);

beforeAll(async () => {
  await buildTool();
  mkdirSync(bombs, { recursive: true });
  await runTool(["json-bombs", bombs]);
});

afterAll(() => rmSync(bombs, { recursive: true, force: true }));

describe.each(["string-900mb.zip", "depth-million.zip", "key-500mb.zip"])("%s", (file) => {
  test("is refused item_too_large within 5 seconds and under 64 MB", async () => {
    const volumes = labVolumes();
    const archive = volumes.archives.archive(volumes.id);
    renameSync(path.join(bombs, file), archive);
    writeJob(volumes, "x", false);
    const bytes = sizeOf(archive);
    const result = await measure(volumes);
    record("json-bomb", file, bytes, result);
    removeRun(volumes);
    expect(result.summary).toMatchObject({ status: "scanned", posts: 1, skipped: { item_too_large: 1 } });
    expect(result.ms).toBeLessThan(5_000);
    expect(result.peak).toBeLessThan(64 * MB);
  });
});
