import { beforeAll, expect, test } from "vitest";
import { IMPORT_RULES } from "@korbat/contracts";
import { buildTool, labVolumes, measure, record, removeRun, runTool, sizeOf, writeJob } from "./support";

/**
 * The large-archive lab, the importer's half (3b design, 12.5): a generated X archive of about 1.9 GiB (60,000 tweets
 * in a tweets.js of about 400 MB, 5,000 images), a Mastodon outbox of 50,000 Notes, and a CAR of 2,000,000 blocks. Each
 * scans within the 30-minute watchdog with a peak memory under 400 MB. The API's intake of 50,000 lines within its 512m
 * is Task 4's half of this lab.
 */

const MB = 1_048_576;
const PEAK = 400 * MB;

beforeAll(async () => {
  await buildTool();
});

test("an X archive of about 1.9 GiB: 60,000 tweets, the newest 50,000 kept with their 5,000 images", async () => {
  const volumes = labVolumes();
  try {
    const archive = volumes.archives.archive(volumes.id);
    const made = await runTool<{ tweetsBytes: number }>(["x-large", archive]);
    console.log(JSON.stringify({ tweetsJsMb: Math.round(made.tweetsBytes / MB) }));
    writeJob(volumes, "x", true);
    const bytes = sizeOf(archive);
    expect(bytes).toBeLessThanOrEqual(IMPORT_RULES.maxBytes);
    const result = await measure(volumes);
    record("large-archive", "x-60000-tweets-5000-images", bytes, result);
    expect(result.summary).toMatchObject({ status: "scanned", posts: IMPORT_RULES.maxPosts, images: IMPORT_RULES.maxImages, skipped: { over_post_cap: 10_000 } });
    expect(result.ms).toBeLessThan(IMPORT_RULES.watchdogMs);
    expect(result.peak).toBeLessThan(PEAK);
  } finally {
    removeRun(volumes);
  }
});

test("a Mastodon outbox of 50,000 Notes", async () => {
  const volumes = labVolumes();
  try {
    const archive = volumes.archives.archive(volumes.id);
    await runTool(["mastodon-large", archive]);
    writeJob(volumes, "mastodon", false);
    const bytes = sizeOf(archive);
    const result = await measure(volumes);
    record("large-archive", "mastodon-50000-notes", bytes, result);
    expect(result.summary).toMatchObject({ status: "scanned", posts: 50_000 });
    expect(result.ms).toBeLessThan(IMPORT_RULES.watchdogMs);
    expect(result.peak).toBeLessThan(PEAK);
  } finally {
    removeRun(volumes);
  }
});

test("a CAR of 2,000,000 blocks: about 900,000 posts beside likes that are never decoded", async () => {
  const volumes = labVolumes();
  try {
    const archive = volumes.archives.archive(volumes.id);
    const made = await runTool<{ blocks: number; posts: number }>(["car-large", archive, String(IMPORT_RULES.carMaxBlocks)]);
    expect(made.blocks).toBe(IMPORT_RULES.carMaxBlocks);
    writeJob(volumes, "bluesky", false);
    const bytes = sizeOf(archive);
    const result = await measure(volumes);
    record("large-archive", "car-2000000-blocks", bytes, result);
    expect(result.summary).toMatchObject({ status: "scanned", posts: IMPORT_RULES.maxPosts, readInPart: false, skipped: { over_post_cap: made.posts - IMPORT_RULES.maxPosts } });
    expect(result.ms).toBeLessThan(IMPORT_RULES.watchdogMs);
    expect(result.peak).toBeLessThan(PEAK);
  } finally {
    removeRun(volumes);
  }
});

test("the item cap: a CAR of 1,100,000 posts is read up to 1,000,000 items and marked read in part", async () => {
  const volumes = labVolumes();
  try {
    const archive = volumes.archives.archive(volumes.id);
    await runTool(["car-large", archive, "1180000", "1"]);
    writeJob(volumes, "bluesky", false);
    const bytes = sizeOf(archive);
    const result = await measure(volumes);
    record("large-archive", "car-item-cap", bytes, result);
    expect(result.summary).toMatchObject({
      status: "scanned",
      posts: IMPORT_RULES.maxPosts,
      readInPart: true,
      skipped: { over_item_cap: 1, over_post_cap: IMPORT_RULES.maxItems - IMPORT_RULES.maxPosts },
    });
    expect(result.ms).toBeLessThan(IMPORT_RULES.watchdogMs);
    expect(result.peak).toBeLessThan(PEAK);
  } finally {
    removeRun(volumes);
  }
});
