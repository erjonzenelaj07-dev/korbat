import { createHash, randomFillSync } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { constants, crc32, deflateRawSync } from "node:zlib";
import { CarWriter } from "@ipld/car/writer";
import * as dagCbor from "@ipld/dag-cbor";
import { CID } from "multiformats/cid";
import * as Digest from "multiformats/hashes/digest";
import pino from "pino";
import { archivesLayout, workLayout } from "@korbat/import-protocol";
import { scanJob } from "../../src/scan";
import { CANARY, FIXTURE_DID } from "../fixtures/canaries";
import { createActivity, outboxJson } from "../fixtures/mastodon";
import { tweetObject, xManifest, type TweetSpec } from "../fixtures/x";
import { StreamingZip, repeatedDeflate } from "./zip-writer";

/**
 * The labs' tool (3b design, 12.5), bundled by the labs into the lab volume and run in processes of its own, so that the
 * vitest processes stay small and every scan's memory is its own: `scan` runs one scan and prints its time and memory;
 * the other commands write the archives the labs read, a chunk at a time. Every archive is built by code.
 *
 *   node tool.mjs scan <archives root> <work root> <id>
 *   node tool.mjs <zip-bombs | json-bombs | traversal | x-large | mastodon-large | car-large> <folder>
 */

const LF = String.fromCharCode(10);
const MB = 1_048_576;

/** A block of pseudo-random lowercase letters: text that neither compresses much nor holds a quote or an escape. */
function letters(length: number, seed = 1): Buffer {
  const out = Buffer.alloc(length);
  randomFillSync(out);
  for (let i = 0; i < length; i++) out[i] = 0x61 + (out[i]! % 26);
  if (seed < 0) out.reverse();
  return out;
}

function* repeat(block: Buffer, total: number): Generator<Buffer> {
  for (let sent = 0; sent < total; sent += block.length) yield sent + block.length <= total ? block : block.subarray(0, total - sent);
}

const PREFIX = "window.YTD.tweets.part0 = ";
const plainTweet = (n: number, text: string, extra: Partial<TweetSpec> = {}): TweetSpec => ({ id: String(1_500_000_000_000_000_000n + BigInt(n)), at: new Date(Date.UTC(2015, 0, 1) + n * 3_600_000).toISOString(), text, ...extra });

// ---- scan --------------------------------------------------------------------------------------------------------

async function scan(archivesRoot: string, workRoot: string, id: string): Promise<void> {
  const archives = archivesLayout(archivesRoot);
  const work = workLayout(workRoot);
  for (const dir of [work.jobs, work.attempts, work.tmp]) mkdirSync(dir, { recursive: true });
  const log = pino({ level: "silent" });
  // With --expose-gc, the baseline is taken after a collection.
  (globalThis as { gc?: () => void }).gc?.();
  const rssBefore = process.memoryUsage().rss;
  const started = performance.now();
  const outcome = await scanJob({ archives, work, log }, id, new AbortController().signal);
  const ms = Math.round(performance.now() - started);
  // maxRSS is the process's peak resident set in kilobytes; the scan is all this process does after rssBefore.
  const maxRss = process.resourceUsage().maxRSS * 1024;
  const summary = existsSync(work.summary(id)) ? JSON.parse(readFileSync(work.summary(id), "utf8")) : null;
  process.stdout.write(JSON.stringify({ outcome, ms, rssBefore, maxRss, peak: maxRss - rssBefore, summary }) + LF);
}

// ---- zip bombs ---------------------------------------------------------------------------------------------------

const manifestEntry = () => ({ name: "data/manifest.js", data: Buffer.from(xManifest({}, ["data/tweets.js"].concat(Array.from({ length: 99 }, (_, i) => `data/tweets-part${i + 1}.js`)))) });

/** A local header with flag bit 3 (its CRC and sizes are the descriptor's), stored at `method`. */
function localHeader(name: string, method: number): Buffer {
  const raw = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE((1 << 3) | (1 << 11), 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(raw.length, 26);
  return Buffer.concat([header, raw]);
}

interface CentralSpec {
  name: string;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  /** Write the sizes and the offset in a ZIP64 extra field. */
  zip64?: boolean;
}

function centralRecord(spec: CentralSpec): Buffer {
  const raw = Buffer.from(spec.name, "utf8");
  const extra = Buffer.alloc(spec.zip64 ? 28 : 0);
  if (spec.zip64) {
    extra.writeUInt16LE(1, 0);
    extra.writeUInt16LE(24, 2);
    extra.writeBigUInt64LE(BigInt(spec.size), 4);
    extra.writeBigUInt64LE(BigInt(spec.compressed), 12);
    extra.writeBigUInt64LE(BigInt(spec.offset), 20);
  }
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | 45, 4);
  header.writeUInt16LE(45, 6);
  header.writeUInt16LE((1 << 3) | (1 << 11), 8);
  header.writeUInt16LE(spec.method, 10);
  header.writeUInt32LE(spec.crc >>> 0, 16);
  header.writeUInt32LE(spec.zip64 ? 0xffffffff : spec.compressed, 20);
  header.writeUInt32LE(spec.zip64 ? 0xffffffff : spec.size, 24);
  header.writeUInt16LE(raw.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt32LE(((0o100000 | 0o644) << 16) >>> 0, 38);
  header.writeUInt32LE(spec.zip64 ? 0xffffffff : spec.offset, 42);
  return Buffer.concat([header, raw, extra]);
}

/** The end records: ZIP64 ones (count, size and offset in 64 bits, with `offsetLie` added to the offset) and the classic one. */
function endRecords(count: number, directorySize: number, directoryOffset: number, zip64: boolean, offsetLie = 0): Buffer {
  const parts: Buffer[] = [];
  const recordAt = directoryOffset + directorySize;
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(directorySize), 40);
    record.writeBigUInt64LE(BigInt(directoryOffset + offsetLie), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(recordAt), 8);
    locator.writeUInt32LE(1, 16);
    parts.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : count, 8);
  end.writeUInt16LE(zip64 ? 0xffff : count, 10);
  end.writeUInt32LE(zip64 ? 0xffffffff : directorySize, 12);
  end.writeUInt32LE(zip64 ? 0xffffffff : directoryOffset, 16);
  parts.push(end);
  return Buffer.concat(parts);
}

/** The manifest as a stored entry with an honest local header, and its central record. */
function manifestRecords(): { local: Buffer; central: (offset: number) => Buffer } {
  const { name, data } = manifestEntry();
  const raw = Buffer.from(name, "utf8");
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(1 << 11, 6);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(raw.length, 26);
  const local = Buffer.concat([header, raw, data]);
  return {
    local,
    central: (offset) => {
      const record = centralRecord({ name, method: 0, crc, compressed: data.length, size: data.length, offset });
      record.writeUInt16LE(1 << 11, 8);
      return record;
    },
  };
}

/**
 * The overlapping-files bomb: `count` allowlisted entries whose local headers all lie inside one region of `region`
 * bytes, every entry's data running to the region's end, each declaring `size` bytes (ZIP64 when it needs it).
 */
async function overlapBomb(file: string, count: number, region: number, size: (compressed: number) => number): Promise<void> {
  const manifest = manifestRecords();
  const start = manifest.local.length;
  const body = letters(region);
  const centrals: Buffer[] = [manifest.central(0)];
  const names = ["data/tweets.js", ...Array.from({ length: 98 }, (_, i) => `data/tweets-part${i + 1}.js`)].slice(0, count);
  names.forEach((name, i) => {
    const at = i * 100;
    localHeader(name, 8).copy(body, at);
    const dataStart = start + at + 30 + Buffer.byteLength(name);
    // Each entry's data runs to the region's end, less a descriptor's 12 bytes: every range overlaps every other.
    const compressed = start + region - 12 - dataStart;
    const declared = size(compressed);
    centrals.push(centralRecord({ name, method: 8, crc: 0, compressed, size: declared, offset: start + at, zip64: declared > 0xfffffffe }));
  });
  const central = Buffer.concat(centrals);
  const zip64 = centrals.length > 1 && names.length > 0;
  writeFileSync(file, Buffer.concat([manifest.local, body, central, endRecords(centrals.length, central.length, start + region, zip64)]));
}

async function zipBombs(dir: string): Promise<void> {
  // 1. A 10 MB file whose 99 overlapping entries declare a terabyte each.
  await overlapBomb(path.join(dir, "overlap-terabytes.zip"), 99, 10 * MB, () => 2 ** 40);
  // 2. The same overlap within every per-entry limit and the sum: four entries of 1,000,000,000 bytes, ratio 100.
  await overlapBomb(path.join(dir, "overlap-within-limits.zip"), 4, 10 * MB, (compressed) => Math.min(compressed * 100, 1_000_000_000));

  // 3. A ratio bomb within one entry: tweets.js declares 100 MB (ratio about 50) and inflates to 2 GiB of spaces.
  {
    const manifest = manifestRecords();
    const prefix = deflateRawSync(Buffer.from(PREFIX + "["), { finishFlush: constants.Z_FULL_FLUSH });
    const { stream } = await repeatedDeflate(Buffer.alloc(16 * MB, 0x20), 128);
    const compressed = prefix.length + stream.reduce((sum, part) => sum + part.length, 0);
    const local = localHeader("data/tweets.js", 8);
    const offset = manifest.local.length;
    const handle = await open(path.join(dir, "ratio-bomb.zip"), "w");
    let position = 0;
    const write = async (bytes: Buffer) => {
      await handle.write(bytes, 0, bytes.length, position);
      position += bytes.length;
    };
    await write(manifest.local);
    await write(local);
    await write(prefix);
    for (const part of stream) await write(part);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(compressed, 8);
    descriptor.writeUInt32LE(100 * MB, 12);
    await write(descriptor);
    const central = Buffer.concat([manifest.central(0), centralRecord({ name: "data/tweets.js", method: 8, crc: 0, compressed, size: 100 * MB, offset })]);
    const directoryOffset = position;
    await write(central);
    await write(endRecords(2, central.length, directoryOffset, false));
    await handle.close();
  }

  // 4. A central directory of 1,000,000 entries, with their local records.
  {
    const count = 1_000_000;
    const out = createWriteStream(path.join(dir, "million-entries.zip"));
    const writeOut = (bytes: Buffer) =>
      new Promise<void>((resolve) => {
        if (out.write(bytes)) resolve();
        else out.once("drain", () => resolve());
      });
    const manifest = manifestRecords();
    await writeOut(manifest.local);
    let position = manifest.local.length;
    const name = (i: number) => `data/f${String(i).padStart(7, "0")}.js`;
    const empty = crc32(Buffer.alloc(0));
    let batch: Buffer[] = [];
    const flush = async () => {
      if (batch.length > 0) await writeOut(Buffer.concat(batch));
      batch = [];
    };
    for (let i = 0; i < count; i++) {
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(1 << 11, 6);
      header.writeUInt32LE(empty, 14);
      header.writeUInt16LE(16, 26);
      batch.push(header, Buffer.from(name(i)));
      if (batch.length >= 20_000) await flush();
    }
    await flush();
    position += count * 46;
    const directoryOffset = position;
    await writeOut(manifest.central(0));
    let directorySize = manifest.central(0).length;
    for (let i = 0; i < count; i++) {
      const record = centralRecord({ name: name(i), method: 0, crc: empty, compressed: 0, size: 0, offset: manifest.local.length + i * 46 });
      record.writeUInt16LE(1 << 11, 8);
      batch.push(record);
      directorySize += record.length;
      if (batch.length >= 20_000) await flush();
    }
    await flush();
    await writeOut(endRecords(count + 1, directorySize, directoryOffset, true));
    await new Promise<void>((resolve) => out.end(resolve));
  }

  // 5. ZIP64 records that lie: the directory's offset past the file, a size of 2^62, and an entry's offset past its directory.
  {
    const manifest = manifestRecords();
    const data = Buffer.from(PREFIX + "[]");
    const local = Buffer.concat([localHeader("data/tweets.js", 0), data]);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc32(data), 4);
    descriptor.writeUInt32LE(data.length, 8);
    descriptor.writeUInt32LE(data.length, 12);
    const body = Buffer.concat([manifest.local, local, descriptor]);
    const tweets = (overrides: Partial<CentralSpec>) =>
      centralRecord({ name: "data/tweets.js", method: 0, crc: crc32(data), compressed: data.length, size: data.length, offset: manifest.local.length, zip64: true, ...overrides });
    const write = (file: string, central: Buffer, offsetLie = 0) => writeFileSync(path.join(dir, file), Buffer.concat([body, central, endRecords(2, central.length, body.length, true, offsetLie)]));
    write("zip64-offset-past-end.zip", Buffer.concat([manifest.central(0), tweets({})]), 2 ** 40);
    write("zip64-size-lies.zip", Buffer.concat([manifest.central(0), tweets({ size: 2 ** 62 })]));
    write("zip64-entry-offset-lies.zip", Buffer.concat([manifest.central(0), tweets({ offset: 2 ** 45 })]));
  }
  process.stdout.write(JSON.stringify({ dir }) + LF);
}

// ---- JSON bombs --------------------------------------------------------------------------------------------------

async function jsonBombs(dir: string): Promise<void> {
  const normal = JSON.stringify(tweetObject(plainTweet(1, "A normal post before the bomb")));
  const block = letters(MB);
  const archive = async (file: string, parts: () => Iterable<Buffer>) => {
    const zip = await StreamingZip.create(path.join(dir, file));
    await zip.add("data/manifest.js", [manifestEntry().data], 0);
    await zip.add("data/tweets.js", parts(), 0);
    await zip.finish();
  };
  await archive("string-900mb.zip", function* () {
    yield Buffer.from(`${PREFIX}[${normal}, {"tweet": {"id_str": "1", "full_text": "`);
    yield* repeat(block, 900 * MB);
    yield Buffer.from('"}}]');
  });
  await archive("depth-million.zip", function* () {
    yield Buffer.from(`${PREFIX}[${normal}, `);
    yield* repeat(Buffer.alloc(MB, "["), 1_000_000);
    yield* repeat(Buffer.alloc(MB, "]"), 1_000_000);
    yield Buffer.from("]");
  });
  await archive("key-500mb.zip", function* () {
    yield Buffer.from(`${PREFIX}[${normal}, {"`);
    yield* repeat(block, 500 * MB);
    yield Buffer.from('": 1}]');
  });
  process.stdout.write(JSON.stringify({ dir }) + LF);
}

// ---- traversal ---------------------------------------------------------------------------------------------------

async function traversal(dir: string): Promise<void> {
  const { buildZip } = await import("../fixtures/zip");
  const photo = plainTweet(2, "A photo whose file is a symlink https://t.co/sym111", { media: [{ url: "https://t.co/sym111", file: "Fsym0001.jpg" }] });
  const tweets = [plainTweet(1, "A post beside crafted names"), photo];
  const NUL = String.fromCharCode(0);
  const BACKSLASH = String.fromCharCode(92);
  const crafted = [
    "../../../tmp/evil.txt",
    "../outbox.json",
    "/etc/cron.d/evil",
    "C:/evil.txt",
    `data${BACKSLASH}tweets.js`,
    `data${BACKSLASH}..${BACKSLASH}..${BACKSLASH}evil.txt`,
    `data/tweets.js${NUL}.txt`,
    "a".repeat(513),
    "data//tweets.js",
    "data/./tweets.js",
    "data/tweets_media/../../../../etc/passwd",
    "data/tweets_media/1500000000000000002-Fsym0001.jpg/../../../evil",
  ];
  const archive = buildZip([
    { name: "data/manifest.js", data: xManifest({}, ["data/tweets.js"]) },
    { name: "data/tweets.js", data: PREFIX + JSON.stringify(tweets.map(tweetObject)) },
    ...crafted.map((name) => ({ name: Buffer.from(name, "utf8"), data: `evil ${CANARY.private}` })),
    // Symbolic links, one under a media name a kept post names and one under an allowlisted data name: ignored, never opened.
    { name: "data/tweets_media/1500000000000000002-Fsym0001.jpg", data: "/etc/passwd", symlink: true, method: 0 },
    { name: "data/note-tweet.js", data: "/etc/passwd", symlink: true, method: 0 },
  ]);
  writeFileSync(path.join(dir, "crafted-names.zip"), archive);
  process.stdout.write(JSON.stringify({ dir }) + LF);
}

// ---- large archives ----------------------------------------------------------------------------------------------

async function xLarge(file: string): Promise<void> {
  const tweets = 60_000;
  const images = 5_000;
  const imageBytes = 360_000;
  // About 6,700 bytes a tweet, as an archive's pretty-printed tweets with their entities weigh: 400 MB for 60,000. Each
  // tweet's padding is its own slice of a large random pool: one padding repeated would deflate far past the ratio of 100.
  const pool = letters(64 * MB).toString("latin1");
  const padding = (n: number) => {
    const at = (n * 5_207) % (pool.length - 5_200);
    return pool.slice(at, at + 5_200);
  };
  let tweetsBytes = 0;
  const zip = await StreamingZip.create(file);
  await zip.add("data/manifest.js", [Buffer.from(xManifest({}, ["data/tweets.js"]))], 0);
  await zip.add(
    "data/tweets.js",
    (function* () {
      yield Buffer.from(`${PREFIX}[` + LF);
      for (let n = 0; n < tweets; n++) {
        const withPhoto = n >= tweets - images;
        const spec = plainTweet(n, `Post number ${n} of the large archive, with a link https://t.co/l${n} and some words to read`, {
          urls: [{ url: `https://t.co/l${n}`, expanded: `https://example.com/${n}` }],
          ...(withPhoto ? { media: [{ url: `https://t.co/m${n}`, file: `F${String(n).padStart(8, "0")}.jpg` }] } : {}),
        });
        const object = tweetObject(spec) as { tweet: Record<string, unknown> };
        object.tweet.padding = padding(n);
        const bytes = Buffer.from((n > 0 ? "," + LF : "") + JSON.stringify(object, null, 2));
        tweetsBytes += bytes.length;
        yield bytes;
      }
      yield Buffer.from(LF + "]");
    })(),
    8,
  );
  const photo = Buffer.alloc(imageBytes);
  randomFillSync(photo);
  photo.set([0xff, 0xd8, 0xff, 0xe0], 0);
  for (let n = tweets - images; n < tweets; n++) {
    const id = String(1_500_000_000_000_000_000n + BigInt(n));
    await zip.add(`data/tweets_media/${id}-F${String(n).padStart(8, "0")}.jpg`, [photo], 0);
  }
  await zip.add("data/direct-messages.js", [Buffer.from(`window.YTD.direct_messages.part0 = [{"text": "${CANARY.dm}"}]`)], 8);
  const size = await zip.finish();
  process.stdout.write(JSON.stringify({ file, size, tweetsBytes }) + LF);
}

async function mastodonLarge(file: string): Promise<void> {
  const notes = 50_000;
  const zip = await StreamingZip.create(file);
  await zip.add(
    "outbox.json",
    (function* () {
      const head = outboxJson([], false).replace('"orderedItems": []', '"orderedItems": [');
      yield Buffer.from(head.slice(0, head.lastIndexOf("[") + 1) + LF);
      for (let n = 0; n < notes; n++) {
        const at = new Date(Date.UTC(2017, 0, 1) + n * 3_600_000).toISOString();
        const activity = createActivity({ n: n % 100, at, content: `<p>Note number ${n} of the large outbox, with <a href="https://example.com/${n}">a link</a> &amp; an entity</p>` });
        (activity.object as Record<string, unknown>).id = `https://social.example/users/${CANARY.handle}/statuses/${200_000_000_000_000 + n}`;
        yield Buffer.from((n > 0 ? "," + LF : "") + JSON.stringify(activity));
      }
      yield Buffer.from(LF + "]}");
    })(),
    8,
  );
  await zip.add("actor.json", [Buffer.from(JSON.stringify({ type: "Person", preferredUsername: CANARY.handle }))], 8);
  const size = await zip.finish();
  process.stdout.write(JSON.stringify({ file, size }) + LF);
}

const SHA256 = 0x12;
function cborBlock(value: unknown): { cid: CID; bytes: Uint8Array } {
  const bytes = dagCbor.encode(value);
  return { cid: CID.create(1, dagCbor.code, Digest.create(SHA256, createHash("sha256").update(bytes).digest())), bytes };
}

/**
 * A repository of exactly `total` blocks: post records under a 16-way MST built top-down over index ranges (so no list
 * of leaves is ever held), the commit, and unreferenced blocks to make up the count. Every node holds up to 16 entries
 * and its subtrees are as full as the range allows, so the nodes are about a fifteenth of the records. Keys are
 * fixed-width, so index order is key order, and dates rise with the key, as TIDs do: every record is newer than the last.
 */
async function carLarge(file: string, total = 2_000_000, postShare = 0.48): Promise<void> {
  const fanout = 16;
  // The records and the nodes over them (about 7 in 100 of the records) and the commit stay under `total`. A share of the
  // records are posts; the rest are likes, whose keys sort before the posts' and which the importer never decodes.
  const records = Math.floor((total - 1) / 1.07);
  const posts = Math.floor(records * postShare);
  const likes = records - posts;
  const placeholder = cborBlock({ placeholder: true }).cid;
  const { writer, out } = CarWriter.create([placeholder]);
  const stream = createWriteStream(file);
  const piped = (async () => {
    for await (const chunk of out) if (!stream.write(chunk)) await new Promise<void>((resolve) => stream.once("drain", () => resolve()));
    await new Promise<void>((resolve) => stream.end(resolve));
  })();
  let blocks = 0;
  const put = async (block: { cid: CID; bytes: Uint8Array }) => {
    blocks++;
    await writer.put(block);
  };
  const encoder = new TextEncoder();
  const key = (i: number) => (i < likes ? `app.bsky.feed.like/3l${String(i).padStart(11, "0")}` : `app.bsky.feed.post/3l${String(i - likes).padStart(11, "0")}`);
  const record = async (i: number) => {
    const createdAt = new Date(Date.UTC(2023, 0, 1) + i * 60_000).toISOString();
    const value =
      i < likes
        ? { $type: "app.bsky.feed.like", subject: { uri: `at://did:plc:someoneelse234567abcdefg/app.bsky.feed.post/3k${i}`, cid: "bafyrei" }, createdAt }
        : { $type: "app.bsky.feed.post", text: `Post ${i - likes} of the large repository bsky.app/profile/${CANARY.handle}`, createdAt, langs: ["en"] };
    const block = cborBlock(value);
    await put(block);
    return block.cid;
  };
  const shared = (a: Uint8Array, b: Uint8Array) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  };
  /** How many records a tree of `height` levels holds when full: 16 entries a node, 17 subtrees under each. */
  const capacity = (height: number): number => (height <= 1 ? fanout : fanout + (fanout + 1) * capacity(height - 1));
  const node = async (lo: number, hi: number): Promise<CID | null> => {
    if (hi <= lo) return null;
    const lifted: number[] = [];
    if (hi - lo <= fanout) for (let i = lo; i < hi; i++) lifted.push(i);
    else {
      let height = 2;
      while (capacity(height) < hi - lo) height++;
      const below = capacity(height - 1);
      for (let at = lo + below; at < hi && lifted.length < fanout; at += below + 1) lifted.push(at);
    }
    const left = await node(lo, lifted[0]!);
    let previous = new Uint8Array(0);
    const entries = [];
    for (const [index, at] of lifted.entries()) {
      const k = encoder.encode(key(at));
      const p = shared(previous, k);
      previous = k;
      const v = await record(at);
      const t = await node(at + 1, lifted[index + 1] ?? hi);
      entries.push({ k: k.subarray(p), p, t, v });
    }
    const block = cborBlock({ e: entries, l: left });
    await put(block);
    return block.cid;
  };
  const data = await node(0, records);
  const commit = cborBlock({ did: FIXTURE_DID, version: 3, data, rev: "3lcommitrev01", prev: null, sig: new Uint8Array(64) });
  await put(commit);
  for (let i = 0; blocks < total; i++) await put(cborBlock({ $type: "app.bsky.feed.like", n: i }));
  await writer.close();
  await piped;
  const handle = await open(file, "r+");
  await CarWriter.updateRootsInFile(handle, [commit.cid]);
  await handle.close();
  process.stdout.write(JSON.stringify({ file, blocks, records, posts, likes }) + LF);
}

// ---- main --------------------------------------------------------------------------------------------------------

const [command, ...args] = process.argv.slice(2);
const commands: Record<string, (...args: string[]) => Promise<void>> = {
  scan: (archivesRoot, workRoot, id) => scan(archivesRoot!, workRoot!, id!),
  "zip-bombs": (dir) => zipBombs(dir!),
  "json-bombs": (dir) => jsonBombs(dir!),
  traversal: (dir) => traversal(dir!),
  "x-large": (file) => xLarge(file!),
  "mastodon-large": (file) => mastodonLarge(file!),
  "car-large": (file, total, share) => carLarge(file!, total ? Number(total) : undefined, share ? Number(share) : undefined),
};
const run = commands[command ?? ""];
if (!run) {
  process.stderr.write(`unknown command ${command ?? ""}` + LF);
  process.exit(2);
}
await run(...args);
