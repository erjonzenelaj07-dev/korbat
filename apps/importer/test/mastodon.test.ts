import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, test } from "vitest";
import { MEDIA_MAX_BYTES } from "@korbat/contracts";
import { isAllowed } from "../src/adapters/types";
import { mastodonAdapter } from "../src/adapters/mastodon/index";
import { CONTENT_WARNING_LABEL, SOURCE_WORDS } from "../src/text";
import { FIXTURE_HOST } from "./fixtures/canaries";
import { lineWith, runScan, scanned, workspace } from "./fixtures/harness";
import { MASTODON_NOTES, buildMastodonArchive, createActivity, mediaPath, outboxJson, statusId } from "./fixtures/mastodon";
import { buildXArchive } from "./fixtures/x";
import { fakeImage, noise } from "./fixtures/zip";

/** The Mastodon adapter: every row of 5.6's table, detect for each failure, and the allowlist. */

const ws = workspace();
afterAll(() => ws.remove());

const scan = (archive: Buffer, images = false) => runScan(ws.dir, { source: "mastodon", archive, images });
const LF = String.fromCharCode(10);

describe("reading a Mastodon archive (images off)", async () => {
  const result = await scan(buildMastodonArchive());
  const summary = scanned(result);
  const { lines } = result;

  test("the counts", () => {
    expect(summary.skipped).toEqual({ not_public: 3, repost: 1, poll: 1, date_out_of_range: 1 });
    expect(summary.imagesSkipped).toEqual({ sensitive: 1, images_off: 4, video: 1, unsupported: 1 });
    expect(summary).toMatchObject({ posts: 14, images: 0, warnings: 1, sourceLinks: 3, protectedPosts: 0, readInPart: false });
    expect(lines).toHaveLength(14);
  });

  test("public and unlisted Notes are kept; HTML becomes text with its entities decoded", () => {
    expect(lineWith(lines, "Hello from Mastodon")).toMatchObject({
      kind: "post",
      text: `Hello from Mastodon & friends ${String.fromCharCode(0x2014)} with 'quotes'${LF}${LF}Second paragraph${LF}with a line break`,
      at: "2019-03-03T10:00:00Z",
    });
    lineWith(lines, "An unlisted post");
  });

  test("a quote keeps its own words without its fallback paragraph", () => {
    expect(lineWith(lines, "My comment").text).toBe("My comment on a quote");
  });

  test("a content warning becomes the first line, marked and counted", () => {
    expect(lineWith(lines, "behind a warning")).toMatchObject({ text: `${CONTENT_WARNING_LABEL}spoilers ahead${LF}${LF}The text behind a warning`, warning: true });
  });

  test("a self-reply is a thread; a reply to another server loses its leading mentions but keeps later ones", () => {
    expect(lineWith(lines, "Following up")).toMatchObject({ kind: "thread", parent: lineWith(lines, "Hello from Mastodon").ref });
    expect(lineWith(lines, "Thanks both")).toMatchObject({ kind: "reply", parent: null, text: "Thanks both, see @dave too" });
  });

  test("links to the person's own statuses and profile become fixed words; a shortened link is whole again", () => {
    expect(lineWith(lines, "My earlier post").text).toBe(`My earlier post ${SOURCE_WORDS.mastodon.post} and my profile ${SOURCE_WORDS.mastodon.profile} and an old one ${SOURCE_WORDS.mastodon.post}`);
    expect(lineWith(lines, "Read https").text).toBe("Read https://example.com/a/very/long/path/that/mastodon/shortens today #korbat");
  });

  test("a date with an offset is converted to UTC and cut to the second", () => {
    expect(lineWith(lines, "Dated with an offset").at).toBe("2019-03-21T01:30:00Z");
  });
});

describe("reading a Mastodon archive (images on)", async () => {
  const result = await scan(buildMastodonArchive(), true);
  const summary = scanned(result);

  test("images with and without a leading slash or a host, their descriptions cleaned; long ones become null and count", () => {
    const photos = lineWith(result.lines, "Two photos");
    expect(photos.media).toEqual([
      { file: `${photos.ref}-0.jpg`, alt: "A described photo" },
      { file: `${photos.ref}-1.png`, alt: null },
    ]);
    const long = lineWith(result.lines, "long description");
    expect(long.media).toEqual([{ file: `${long.ref}-0.webp`, alt: null }]);
    expect(summary.cleaned).toBe(1);
    expect(summary.images).toBe(3);
    expect(result.media.get(`${photos.ref}-1.png`)).toEqual(fakeImage("png", 1_500, 15));
  });

  test("a sensitive post's images are left out, its text kept; a missing file, a video and a GIF are counted", () => {
    expect(lineWith(result.lines, "A sensitive picture").media).toEqual([]);
    expect(summary.imagesSkipped).toEqual({ sensitive: 1, missing_file: 1, video: 1, unsupported: 1 });
  });
});

describe("addressing comes first", () => {
  test("a private Question is not_public, not a poll; an Announce is a repost whatever it embeds", async () => {
    const notes = [
      { ...MASTODON_NOTES.question, to: [`${statusId(0)}/followers`], cc: [] },
      { n: 30, at: "2019-04-01T10:00:00Z", content: "<p>kept</p>" },
    ];
    const result = await scan(buildMastodonArchive({ notes }));
    expect(scanned(result).skipped).toEqual({ not_public: 1 });
  });

  test("an item that is not a Create of an embedded Note, or has no date, is unreadable", async () => {
    const good = createActivity({ n: 31, at: "2019-04-01T10:00:00Z", content: "<p>kept</p>" });
    const undated = createActivity({ n: 32, at: "2019-04-01T10:00:00Z", content: "<p>undated</p>" });
    (undated.object as Record<string, unknown>).published = "yesterday";
    const outbox = JSON.stringify({ type: "OrderedCollection", orderedItems: [good, { type: "Create", object: statusId(33), to: ["https://www.w3.org/ns/activitystreams#Public"] }, { type: "Like" }, "text", undated] });
    const result = await scan(buildMastodonArchive({ outbox }));
    expect(scanned(result)).toMatchObject({ posts: 1, skipped: { unreadable: 4 } });
  });
});

describe("detect and the failures", () => {
  const failure = async (archive: Buffer) => (await scan(archive)).summary;

  test("no outbox.json at the root, or no actor.json, is not_this_source; actor.json is never opened", async () => {
    expect(await failure(buildMastodonArchive({ noOutbox: true }))).toMatchObject({ failure: "not_this_source" });
    expect(await failure(buildMastodonArchive({ noActor: true }))).toMatchObject({ failure: "not_this_source" });
    expect(mastodonAdapter.detect([{ name: "outbox.json", size: 10 }, { name: "actor.json", size: 10 }])).toBeNull();
    expect(mastodonAdapter.detect([{ name: "outbox.json", size: 1_073_741_825 }, { name: "actor.json", size: 10 }])).toBe("not_this_source");
  });

  test("an X archive, a gzip (an instance before 4.2) and anything else", async () => {
    expect(await failure(buildXArchive())).toMatchObject({ failure: "not_this_source" });
    expect(await failure(gzipSync(Buffer.from("tar")))).toMatchObject({ failure: "tar_gz" });
    expect(await failure(noise(100))).toMatchObject({ failure: "not_an_archive" });
  });

  test("an outbox that is not JSON is unreadable; an element over 1 MiB is item_too_large and ends the file", async () => {
    expect(await failure(buildMastodonArchive({ outbox: "{ not json" }))).toMatchObject({ failure: "unreadable" });
    const big = createActivity({ n: 40, at: "2019-04-01T10:00:00Z", content: `<p>${noise(550_000).toString("hex")}</p>` });
    const after = createActivity({ n: 41, at: "2019-04-02T10:00:00Z", content: "<p>after the big one</p>" });
    const before = createActivity({ n: 42, at: "2019-03-31T10:00:00Z", content: "<p>before the big one</p>" });
    const result = await scan(buildMastodonArchive({ outbox: JSON.stringify({ orderedItems: [before, big, after] }) }));
    expect(scanned(result)).toMatchObject({ posts: 1, skipped: { item_too_large: 1 } });
    const logged = result.logs.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.reason === "item_too_large");
    expect(logged).toEqual([expect.objectContaining({ reason: "item_too_large", index: 1 })]);
  });

  test("an image over 20 MiB is too_large", async () => {
    const notes = [{ n: 50, at: "2019-04-01T10:00:00Z", content: "<p>huge</p>", attachment: [{ mediaType: "image/jpeg", url: `/${mediaPath(50)}`, name: "big" }] }];
    const archive = buildMastodonArchive({ notes, extra: [{ name: mediaPath(50), data: Buffer.concat([fakeImage("jpg", 10), noise(MEDIA_MAX_BYTES)]), method: 0 }] });
    const result = await scan(archive, true);
    expect(scanned(result).imagesSkipped).toEqual({ too_large: 1 });
  });

  test("a scan that keeps no post fails nothing_to_import", async () => {
    const outbox = outboxJson([MASTODON_NOTES.private, MASTODON_NOTES.direct], false);
    expect(await failure(buildMastodonArchive({ outbox }))).toMatchObject({ status: "failed", failure: "nothing_to_import" });
  });
});

describe("the allowlist", () => {
  const allowed = (name: string, images = true) => isAllowed(mastodonAdapter.allowlist, name, images);

  test("outbox.json at the root, and original media only while images are on", () => {
    expect(allowed("outbox.json", false)).toBe(true);
    expect(allowed(mediaPath(9))).toBe(true);
    expect(allowed(mediaPath(9), false)).toBe(false);
    expect(allowed("media_attachments/files/109/original/0123456789abcdef.jpeg")).toBe(true);
  });

  test("everything else is refused: actor.json, likes, avatars, small copies, deeper and .. paths", () => {
    for (const name of [
      "actor.json",
      "likes.json",
      "bookmarks.json",
      "avatar.png",
      "header.jpg",
      "x/outbox.json",
      "outbox.json.gz",
      "media_attachments/files/109/000/small/0123456789abcdef.jpg",
      "media_attachments/files/109/000/000/000/000/000/000/000/000/original/0123456789abcdef.jpg",
      "media_attachments/files/109/../original/0123456789abcdef.jpg",
      "media_attachments/files/109/original/0123456789abcdeg.jpg",
      "media_attachments/files/109/original/0123456789abcdef.gif",
      `${FIXTURE_HOST}/media_attachments/files/109/original/0123456789abcdef.jpg`,
    ]) {
      expect(allowed(name), name).toBe(false);
    }
  });
});
