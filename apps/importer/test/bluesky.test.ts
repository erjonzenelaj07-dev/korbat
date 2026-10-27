import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, test } from "vitest";
import { IMPORT_RULES } from "@korbat/contracts";
import { ScanFailure } from "../src/adapters/types";
import { blueskyAdapter } from "../src/adapters/bluesky/index";
import { openCar, type CarLimits } from "../src/car/reader";
import { SOURCE_WORDS } from "../src/text";
import { BLUESKY_POSTS, buildBlueskyArchive, type BlueskyOptions } from "./fixtures/bluesky";
import { lineWith, runScan, scanned, workspace } from "./fixtures/harness";
import { buildMastodonArchive } from "./fixtures/mastodon";
import { noise } from "./fixtures/zip";

/** The Bluesky adapter and the CAR reader: every row of 5.7's table, the two passes, each block checked against its CID. */

const ws = workspace();
afterAll(() => ws.remove());

const scan = async (options: BlueskyOptions = {}, images = false) => runScan(ws.dir, { source: "bluesky", archive: await buildBlueskyArchive(options), images });

describe("reading a Bluesky repository", async () => {
  const result = await scan();
  const summary = scanned(result);
  const { lines } = result;

  test("the counts", () => {
    expect(summary.skipped).toEqual({ adult_label: 2, date_out_of_range: 1 });
    expect(summary.imagesSkipped).toEqual({ bluesky_no_files: 4 });
    expect(summary).toMatchObject({ posts: 11, images: 0, sourceLinks: 3, warnings: 0, protectedPosts: 0, readInPart: false });
  });

  test("a post, a thread under it, and a reply to someone else", () => {
    const plain = lineWith(lines, "Hello from Bluesky");
    expect(plain).toMatchObject({ kind: "post", at: "2023-04-01T10:00:00Z", media: [] });
    expect(lineWith(lines, "Continuing my own thread")).toMatchObject({ kind: "thread", parent: plain.ref });
    expect(lineWith(lines, "Answering someone else")).toMatchObject({ kind: "reply", parent: null });
  });

  test("quotes keep their text, a link card is dropped, image and video embeds are counted, graphic-media is kept", () => {
    lineWith(lines, "Quoting a post");
    lineWith(lines, "Quote with a picture");
    expect(lineWith(lines, "A link card").text).toBe(BLUESKY_POSTS.card.text);
    lineWith(lines, "Two pictures");
    lineWith(lines, "A video");
    lineWith(lines, "graphic but allowed");
    expect(lines.some((line) => line.text.startsWith("Labelled") || line.text.startsWith("Also labelled"))).toBe(false);
  });

  test("bsky.app links and at:// URIs become fixed words", () => {
    expect(lineWith(lines, "My profile").text).toBe(`My profile ${SOURCE_WORDS.bluesky.profile} and a post ${SOURCE_WORDS.bluesky.post} and ${SOURCE_WORDS.bluesky.post}`);
  });

  test("createdAt with an offset is converted to UTC and cut to the second", () => {
    expect(lineWith(lines, "Dated with an offset").at).toBe("2023-04-11T08:00:00Z");
  });

  test("images on changes nothing: the export holds no files", async () => {
    const on = scanned(await scan({}, true));
    expect(on.imagesSkipped).toEqual({ bluesky_no_files: 4 });
    expect(on.images).toBe(0);
  });
});

describe("blocks are checked against their CIDs", () => {
  test("a post whose bytes do not match its CID is unreadable; the rest are read", async () => {
    const summary = scanned(await scan({ corruptPost: BLUESKY_POSTS.quote.rkey }));
    expect(summary.skipped).toEqual({ adult_label: 2, date_out_of_range: 1, unreadable: 1 });
    expect(summary.posts).toBe(10);
  });

  test("a commit whose bytes do not match, or an MST root missing from the file, makes the archive unreadable", async () => {
    expect((await scan({ corruptCommit: true })).summary).toMatchObject({ status: "failed", failure: "unreadable" });
    expect((await scan({ dropMstRoot: true })).summary).toMatchObject({ status: "failed", failure: "unreadable" });
  });

  test("a block over 1,000,000 bytes refuses the archive", async () => {
    expect(IMPORT_RULES.carBlockMaxBytes).toBe(1_000_000);
    expect((await scan({ bigBlock: true })).summary).toMatchObject({ status: "failed", failure: "unreadable" });
  });

  test("a deeper MST (fanout 2) and a flat one read the same posts", async () => {
    const deep = scanned(await scan({ fanout: 2 }));
    const flat = scanned(await scan({ fanout: 64 }));
    expect(deep.posts).toBe(11);
    expect(flat.posts).toBe(11);
  });
});

describe("detect and the failures", () => {
  test("two roots, or a commit that is not version 3, is not_this_source", async () => {
    expect((await scan({ twoRoots: true })).summary).toMatchObject({ failure: "not_this_source" });
    expect((await scan({ commitVersion: 2 })).summary).toMatchObject({ failure: "not_this_source" });
  });

  test("a zip, a gzip and anything else", async () => {
    const run = async (archive: Buffer) => (await runScan(ws.dir, { source: "bluesky", archive })).summary;
    expect(await run(buildMastodonArchive())).toMatchObject({ failure: "not_this_source" });
    expect(await run(gzipSync(Buffer.from("tar")))).toMatchObject({ failure: "tar_gz" });
    expect(await run(Buffer.from('{"chat": "a chat.jsonl line"}' + String.fromCharCode(10)))).toMatchObject({ failure: "not_an_archive" });
    expect(await run(noise(10))).toMatchObject({ failure: "not_an_archive" });
  });

  test("detect takes the one pseudo-entry", () => {
    expect(blueskyAdapter.detect([{ name: "repo.car", size: 100 }])).toBeNull();
    expect(blueskyAdapter.allowlist).toEqual([]);
  });

  test("more than carMaxBlocks blocks is too_many_entries", async () => {
    const bytes = await buildBlueskyArchive();
    const file = path.join(ws.dir, randomUUID());
    writeFileSync(file, bytes);
    const handle = await open(file, "r");
    const attempt = async (limits: Partial<CarLimits>) => {
      try {
        await openCar(handle, bytes.length, { limits });
        return "ok";
      } catch (err) {
        return err instanceof ScanFailure ? err.code : String(err);
      }
    };
    try {
      expect(IMPORT_RULES.carMaxBlocks).toBe(2_000_000);
      expect(await attempt({ maxBlocks: 5 })).toBe("too_many_entries");
      expect(await attempt({})).toBe("ok");
    } finally {
      await handle.close();
    }
  });
});
