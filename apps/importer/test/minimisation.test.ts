import { existsSync, readFileSync } from "node:fs";
import { afterAll, describe, expect, test } from "vitest";
import type { ImportSource } from "@korbat/contracts";
import { buildBlueskyArchive } from "./fixtures/bluesky";
import { FORBIDDEN_STRINGS } from "./fixtures/canaries";
import { runScan, scanned, workspace, type ScanResult } from "./fixtures/harness";
import { buildMastodonArchive } from "./fixtures/mastodon";
import { buildXArchive } from "./fixtures/x";

/**
 * Data minimisation (3b design, 1.5 and 12): for each source, no canary, handle, display name or DID reaches
 * posts.jsonl, summary.json, the media folder (names and bytes), the scratch file or the captured log. The scratch file
 * is deleted when the scan ends; the scan's hook lets this test read it first.
 */

const ws = workspace();
afterAll(() => ws.remove());

function leaks(label: string, bytes: Buffer | string): string[] {
  const text = typeof bytes === "string" ? bytes : bytes.toString("latin1");
  return FORBIDDEN_STRINGS.filter((canary) => text.includes(canary)).map((canary) => `${label} holds ${canary}`);
}

function everyLeak(result: ScanResult): string[] {
  const found: string[] = [];
  found.push(...leaks("posts.jsonl", result.raw));
  found.push(...leaks("summary.json", existsSync(result.work.summary(result.id)) ? readFileSync(result.work.summary(result.id)) : ""));
  for (const [name, bytes] of result.media) found.push(...leaks(`media ${name}`, name), ...leaks(`media ${name}`, bytes));
  found.push(...leaks("scratch", result.scratch ?? ""));
  for (const line of result.logs) found.push(...leaks("log", line));
  return found;
}

const cases: { name: string; source: ImportSource; archive: () => Promise<Buffer> | Buffer; images: boolean }[] = [
  { name: "X, images off", source: "x", archive: () => buildXArchive(), images: false },
  { name: "X, images on", source: "x", archive: () => buildXArchive(), images: true },
  { name: "Mastodon, images off", source: "mastodon", archive: () => buildMastodonArchive(), images: false },
  { name: "Mastodon, images on", source: "mastodon", archive: () => buildMastodonArchive(), images: true },
  { name: "Bluesky", source: "bluesky", archive: () => buildBlueskyArchive(), images: false },
];

describe.each(cases)("$name", ({ source, archive, images }) => {
  test("no canary, handle, name or DID in any output, and the scratch file is gone", async () => {
    const result = await runScan(ws.dir, { source, archive: await archive(), images });
    scanned(result);
    expect(result.scratch?.length ?? 0).toBeGreaterThan(0);
    expect(existsSync(result.work.scratch(result.id))).toBe(false);
    expect(result.lines.length).toBeGreaterThan(5);
    expect(everyLeak(result)).toEqual([]);
  });
});

test("the check itself finds a canary where one is", () => {
  expect(leaks("x", "a CANARY-DM b")).toEqual(["x holds CANARY-DM"]);
});
