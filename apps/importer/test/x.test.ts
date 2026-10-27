import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, test } from "vitest";
import { isAllowed } from "../src/adapters/types";
import { xAdapter } from "../src/adapters/x/index";
import { SOURCE_WORDS } from "../src/text";
import { buildBlueskyArchive } from "./fixtures/bluesky";
import { lineWith, runScan, scanned, workspace } from "./fixtures/harness";
import { buildMastodonArchive } from "./fixtures/mastodon";
import { X_NOTE_TEXT, X_TWEETS, buildXArchive, dataFile, tweetObject, xManifest } from "./fixtures/x";
import { noise } from "./fixtures/zip";

/** The X adapter: every row of 5.5's table, detect for each failure, and the allowlist. */

const ws = workspace();
afterAll(() => ws.remove());

const scan = (archive: Buffer, images = false) => runScan(ws.dir, { source: "x", archive, images });

describe("reading an X archive (images off)", async () => {
  const result = await scan(buildXArchive());
  const summary = scanned(result);
  const { lines } = result;

  test("the counts", () => {
    expect(summary.skipped).toEqual({ repost: 1, not_public: 1, older_version: 1, date_out_of_range: 2, empty: 1 });
    expect(summary.imagesSkipped).toEqual({ sensitive: 1, images_off: 2, video: 2 });
    expect(summary).toMatchObject({ posts: 16, images: 0, warnings: 0, protectedPosts: 1, sourceLinks: 2, cleaned: 0, readInPart: false });
    expect(lines).toHaveLength(16);
    expect(lines.map((line) => line.ref)).toEqual([...lines.keys()]);
  });

  test("a post: unescaped, its t.co link expanded", () => {
    expect(lineWith(lines, "Plain post")).toMatchObject({ text: "Plain post with a link https://example.com/page and & <b> escapes", kind: "post", parent: null, at: "2019-03-03T10:00:00Z", protected: false, warning: false, media: [] });
  });

  test("a self-reply is a thread under the post it answers; a reply to someone else is a reply without the leading mentions", () => {
    const plain = lineWith(lines, "Plain post");
    expect(lineWith(lines, "A reply to my own")).toMatchObject({ kind: "thread", parent: plain.ref });
    expect(lineWith(lines, "Answering")).toMatchObject({ kind: "reply", parent: null, text: "Answering someone else" });
  });

  test("of an edited post only the latest version is kept", () => {
    expect(lines.some((line) => line.text.startsWith("First version"))).toBe(false);
    lineWith(lines, "Second version");
  });

  test("a self-quote and a link to the person's profile become fixed words", () => {
    expect(lineWith(lines, "Quoting myself").text).toBe(`Quoting myself ${SOURCE_WORDS.x.post}`);
    expect(lineWith(lines, "Find me at").text).toBe(`Find me at ${SOURCE_WORDS.x.profile}`);
  });

  test("a truncated post takes its note's whole text; an unmatched note is ignored", () => {
    expect(lineWith(lines, "This is the start of a long note").text).toBe(X_NOTE_TEXT);
    expect(lines.some((line) => line.text.includes("unmatched note"))).toBe(false);
  });

  test("a tweet inside the protected period is marked protected; the rest are not", () => {
    expect(lineWith(lines, "while my account was protected").protected).toBe(true);
    expect(lines.filter((line) => line.protected)).toHaveLength(1);
  });

  test("the 2019 element shape, tweets-part1.js, a stray t.co link, and a media-only post", () => {
    lineWith(lines, "2019 element shape");
    lineWith(lines, "tweets-part1.js");
    expect(lineWith(lines, "A stray t.co link").text).toBe("A stray t.co link goes away");
    expect(lines.some((line) => line.text === "")).toBe(false);
  });

  test("videos and animated GIFs are counted, their posts kept", () => {
    expect(lineWith(lines, "A video post").media).toEqual([]);
    expect(lineWith(lines, "An animated post").media).toEqual([]);
  });

  test("keys are 64 hex and distinct", () => {
    expect(new Set(lines.map((line) => line.key)).size).toBe(lines.length);
  });
});

describe("reading an X archive (images on)", async () => {
  const result = await scan(buildXArchive(), true);
  const summary = scanned(result);

  test("a photo of a kept post is written with no description; a sensitive one and a missing one are counted", () => {
    expect(lineWith(result.lines, "A photo post").media).toEqual([{ file: `${lineWith(result.lines, "A photo post").ref}-0.jpg`, alt: null }]);
    expect(lineWith(result.lines, "A sensitive photo post").media).toEqual([]);
    expect(lineWith(result.lines, "whose file is missing").media).toEqual([]);
    expect(summary.imagesSkipped).toEqual({ sensitive: 1, missing_file: 1, video: 2 });
    expect(summary.images).toBe(2);
    expect(result.media.size).toBe(2);
  });

  test("a media-only post is kept with its image", () => {
    const only = result.lines.find((line) => line.text === "")!;
    expect(only.media).toHaveLength(1);
    expect(only.media[0]!.file).toMatch(/^[0-9]+-0[.]png$/);
    expect(summary.posts).toBe(17);
    expect(summary.skipped).toEqual({ repost: 1, not_public: 1, older_version: 1, date_out_of_range: 2 });
  });
});

describe("other X archives", () => {
  test("the 2018 archive's data/tweet.js", async () => {
    const result = await scan(buildXArchive({ legacy: true }));
    expect(scanned(result).posts).toBeGreaterThan(10);
    lineWith(result.lines, "Plain post");
  });

  test("without a manifest's file list the fixed names are read", async () => {
    const result = await scan(buildXArchive({ noFileList: true }));
    expect(scanned(result).posts).toBe(16);
  });

  test("a tweet's created_at must match X's pattern exactly; anything else, or an element that is no tweet, is unreadable", async () => {
    const good = tweetObject(X_TWEETS.plain);
    const iso = tweetObject({ id: "1100000000000000500", at: "2019-03-03T10:00:00Z", text: "An ISO date X never writes" });
    (iso.tweet as Record<string, unknown>).created_at = "2019-03-03T10:00:00Z";
    const tweetsText = dataFile("tweets", [good, iso, 42, { tweet: { full_text: "no id" } }]);
    const result = await scan(buildXArchive({ tweets: [X_TWEETS.plain], tweetsText }));
    expect(scanned(result)).toMatchObject({ posts: 1, skipped: { unreadable: 3 } });
    // One log line for each unreadable item, with its reason and index only.
    const unreadable = result.logs.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.reason === "unreadable");
    expect(unreadable.map((line) => line.index)).toEqual([1, 2, 3]);
  });
});

describe("detect and the failures", () => {
  const failure = async (archive: Buffer) => (await scan(archive)).summary;

  test("no manifest, or one over 1 MiB, is not_this_source", async () => {
    expect(await failure(buildXArchive({ noManifest: true }))).toMatchObject({ status: "failed", failure: "not_this_source" });
    expect(await failure(buildXArchive({ hugeManifest: true }))).toMatchObject({ status: "failed", failure: "not_this_source" });
  });

  test("a manifest whose prefix is not window.__THAR_CONFIG = exactly, or whose rest is not JSON, is not_this_source", async () => {
    const manifest = xManifest();
    expect(await failure(buildXArchive({ manifestText: manifest.replace("window.__THAR_CONFIG = ", "window.__THAR_CONFIG= ") }))).toMatchObject({ failure: "not_this_source" });
    expect(await failure(buildXArchive({ manifestText: manifest.replace("window.__THAR_CONFIG = ", "window.__THAR_CONFIG = alert(1);") }))).toMatchObject({ failure: "not_this_source" });
    expect(await failure(buildXArchive({ manifestText: manifest + ";" }))).toMatchObject({ status: "scanned" });
  });

  test("a data file whose prefix is not window.YTD.<name>.part<N> = is unreadable", async () => {
    const tweetsText = dataFile("tweets", [tweetObject(X_TWEETS.plain)]).replace("window.YTD.tweets.part0 = ", "var tweets = ");
    expect(await failure(buildXArchive({ tweets: [X_TWEETS.plain], tweetsText }))).toMatchObject({ failure: "unreadable" });
  });

  test("a partial archive is partial_archive", async () => {
    expect(await failure(buildXArchive({ partial: true }))).toMatchObject({ status: "failed", failure: "partial_archive" });
  });

  test("a Mastodon archive, a CAR, a gzip and anything else", async () => {
    expect(await failure(buildMastodonArchive())).toMatchObject({ failure: "not_this_source" });
    expect(await failure(await buildBlueskyArchive())).toMatchObject({ failure: "not_this_source" });
    expect(await failure(gzipSync(Buffer.from("a tar")))).toMatchObject({ failure: "tar_gz" });
    expect(await failure(noise(5_000))).toMatchObject({ failure: "not_an_archive" });
  });
});

describe("the allowlist", () => {
  const allowed = (name: string, images = true) => isAllowed(xAdapter.allowlist, name, images);

  test("the data files, and media only while images are on", () => {
    for (const name of ["data/manifest.js", "data/tweets.js", "data/tweet.js", "data/tweets-part1.js", "data/tweets-part99.js", "data/note-tweet.js", "data/twitter-circle-tweet.js", "data/protected-history.js"]) {
      expect(allowed(name, false)).toBe(true);
    }
    expect(allowed("data/tweets_media/1100000000000000012-Fphoto01.jpg")).toBe(true);
    expect(allowed("data/tweet_media/12-abc_DEF-1.webp")).toBe(true);
    expect(allowed("data/tweets_media/1100000000000000012-Fphoto01.jpg", false)).toBe(false);
  });

  test("everything else is refused: the private files, part 0 and 100, deeper and .. paths", () => {
    for (const name of [
      "data/direct-messages.js",
      "data/direct-messages-group.js",
      "data/ip-audit.js",
      "data/deleted-tweets.js",
      "data/like.js",
      "data/follower.js",
      "data/account.js",
      "data/tweets-part0.js",
      "data/tweets-part100.js",
      "data/tweets.js.bak",
      "x/data/tweets.js",
      "data/tweets_media/sub/12-abc.jpg",
      "data/tweets_media/../12-abc.jpg",
      "data/tweets_media/12-abc.gif",
      "data/direct_messages_media/12-abc.jpg",
      "data/tweets_media/12-" + "a".repeat(65) + ".jpg",
    ]) {
      expect(allowed(name), name).toBe(false);
    }
  });
});
