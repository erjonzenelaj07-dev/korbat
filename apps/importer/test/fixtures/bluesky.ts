import { createHash } from "node:crypto";
import { CarWriter } from "@ipld/car/writer";
import * as dagCbor from "@ipld/dag-cbor";
import { CID } from "multiformats/cid";
import * as Digest from "multiformats/hashes/digest";
import { CANARY, FIXTURE_DID } from "./canaries";

/**
 * A Bluesky repository export built by code (3b design, section 12.1): a CAR written with @ipld/car's writer and
 * @ipld/dag-cbor, a commit, a two-level MST whose keys are prefix-compressed as atproto's repository spec writes them,
 * posts covering 5.7's table, a post linking the fixture's own profile, like and follow records holding canaries, the
 * blocks in a shuffled order, an extra block outside the tree, and switches for a block whose bytes do not match its
 * CID and for a block of 1,000,001 bytes.
 */

const SHA256 = 0x12;
const RAW = 0x55;

export interface Block {
  cid: CID;
  bytes: Uint8Array;
}

/** A DAG-CBOR block and its CID (CIDv1, sha2-256), hashed with node:crypto as the reader checks it. */
export function cborBlock(value: unknown): Block {
  const bytes = dagCbor.encode(value);
  const digest = Digest.create(SHA256, createHash("sha256").update(bytes).digest());
  return { cid: CID.create(1, dagCbor.code, digest), bytes };
}

function rawBlock(bytes: Uint8Array): Block {
  const digest = Digest.create(SHA256, createHash("sha256").update(bytes).digest());
  return { cid: CID.create(1, RAW, digest), bytes };
}

const encoder = new TextEncoder();

/** Shared prefix length of two byte strings. */
function shared(a: Uint8Array, b: Uint8Array): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export interface Leaf {
  key: string;
  cid: CID;
}

/**
 * An MST over sorted leaves: a node holds up to `fanout` entries; when there are more, every (fanout+1)-th key is lifted
 * into the node and the runs between them become its subtrees (`l` before the first, each entry's `t` after it). Keys
 * within a node are prefix-compressed: `p` bytes shared with the previous entry's key, then the rest in `k`. Every node
 * block is pushed to `out`; the root's CID is returned.
 */
export function buildMst(leaves: readonly Leaf[], fanout: number, out: Block[]): CID {
  const node = (run: readonly Leaf[]): CID | null => {
    if (run.length === 0) return null;
    let lifted: number[];
    if (run.length <= fanout) lifted = run.map((_, index) => index);
    else {
      const step = Math.ceil(run.length / fanout);
      lifted = [];
      for (let index = step - 1; index < run.length; index += step) lifted.push(index);
    }
    const left = node(run.slice(0, lifted[0]!));
    let previous = new Uint8Array(0);
    const entries = lifted.map((at, i) => {
      const key = encoder.encode(run[at]!.key);
      const p = shared(previous, key);
      previous = key;
      const next = lifted[i + 1] ?? run.length;
      return { k: key.subarray(p), p, t: node(run.slice(at + 1, next)), v: run[at]!.cid };
    });
    const block = cborBlock({ e: entries, l: left });
    out.push(block);
    return block.cid;
  };
  return node(leaves) ?? (() => {
    const empty = cborBlock({ e: [], l: null });
    out.push(empty);
    return empty.cid;
  })();
}

export interface PostSpec {
  rkey: string;
  text: string;
  createdAt: string;
  reply?: string;
  embed?: Record<string, unknown>;
  labels?: string[];
}

export const atUri = (rkey: string, did = FIXTURE_DID) => `at://${did}/app.bsky.feed.post/${rkey}`;
const OTHER_DID = "did:plc:someoneelse234567abcdefg";
const strongRef = (uri: string) => ({ uri, cid: "bafyreib2rxk3rh6kzwq" });
const imageRef = () => ({ $type: "blob", ref: rawBlock(encoder.encode("not in the export")).cid, mimeType: "image/jpeg", size: 1234 });

export const BLUESKY_POSTS = {
  plain: { rkey: "3kaaaaaaaaa01", text: "Hello from Bluesky", createdAt: "2023-04-01T10:00:00.000Z" },
  thread: { rkey: "3kaaaaaaaaa02", text: "Continuing my own thread", createdAt: "2023-04-01T10:05:00.000Z", reply: atUri("3kaaaaaaaaa01") },
  reply: { rkey: "3kaaaaaaaaa03", text: "Answering someone else", createdAt: "2023-04-02T10:00:00.000Z", reply: atUri("3kzzzzzzzzz99", OTHER_DID) },
  quote: { rkey: "3kaaaaaaaaa04", text: "Quoting a post", createdAt: "2023-04-03T10:00:00.000Z", embed: { $type: "app.bsky.embed.record", record: strongRef(atUri("3kzzzzzzzzz98", OTHER_DID)) } },
  images: {
    rkey: "3kaaaaaaaaa05",
    text: "Two pictures",
    createdAt: "2023-04-04T10:00:00.000Z",
    embed: { $type: "app.bsky.embed.images", images: [{ alt: "one", image: imageRef() }, { alt: "two", image: imageRef() }] },
  },
  video: { rkey: "3kaaaaaaaaa06", text: "A video", createdAt: "2023-04-05T10:00:00.000Z", embed: { $type: "app.bsky.embed.video", video: imageRef() } },
  quoteWithMedia: {
    rkey: "3kaaaaaaaaa07",
    text: "Quote with a picture",
    createdAt: "2023-04-06T10:00:00.000Z",
    embed: { $type: "app.bsky.embed.recordWithMedia", record: { record: strongRef(atUri("3kzzzzzzzzz97", OTHER_DID)) }, media: { $type: "app.bsky.embed.images", images: [{ alt: "", image: imageRef() }] } },
  },
  card: {
    rkey: "3kaaaaaaaaa08",
    text: "A link card example.com/article",
    createdAt: "2023-04-07T10:00:00.000Z",
    embed: { $type: "app.bsky.embed.external", external: { uri: "https://example.com/article", title: "Article", description: "card" } },
  },
  adult: { rkey: "3kaaaaaaaaa09", text: "Labelled for adults", createdAt: "2023-04-08T10:00:00.000Z", labels: ["porn"] },
  graphic: { rkey: "3kaaaaaaaaa10", text: "A graphic but allowed post", createdAt: "2023-04-09T10:00:00.000Z", labels: ["graphic-media"] },
  links: {
    rkey: "3kaaaaaaaaa11",
    text: `My profile bsky.app/profile/${CANARY.handle}.bsky.social and a post https://bsky.app/profile/${CANARY.handle}.bsky.social/post/3kaaaaaaaaa01 and ${atUri("3kaaaaaaaaa02")}`,
    createdAt: "2023-04-10T10:00:00.000Z",
  },
  offset: { rkey: "3kaaaaaaaaa12", text: "Dated with an offset", createdAt: "2023-04-11T10:00:00.5+02:00" },
  tooOld: { rkey: "3kaaaaaaaaa13", text: "Dated before the first tweet", createdAt: "1999-01-01T00:00:00Z" },
  nudity: { rkey: "3kaaaaaaaaa14", text: "Also labelled", createdAt: "2023-04-12T10:00:00Z", labels: ["nudity"] },
} satisfies Record<string, PostSpec>;

function postRecord(spec: PostSpec): Record<string, unknown> {
  return {
    $type: "app.bsky.feed.post",
    text: spec.text,
    createdAt: spec.createdAt,
    langs: ["en"],
    facets: [],
    ...(spec.reply ? { reply: { root: strongRef(spec.reply), parent: strongRef(spec.reply) } } : {}),
    ...(spec.embed ? { embed: spec.embed } : {}),
    ...(spec.labels ? { labels: { $type: "com.atproto.label.defs#selfLabels", values: spec.labels.map((val) => ({ val })) } } : {}),
  };
}

export interface BlueskyOptions {
  posts?: PostSpec[];
  /** The rkey of a post whose block bytes no longer match its CID. */
  corruptPost?: string;
  /** Corrupt the commit block's bytes instead. */
  corruptCommit?: boolean;
  /** Add a raw block of 1,000,001 bytes outside the tree. */
  bigBlock?: boolean;
  /** Write the CAR's header with two roots. */
  twoRoots?: boolean;
  /** The commit's version. */
  commitVersion?: number;
  /** Leave the MST's root node out of the CAR. */
  dropMstRoot?: boolean;
  fanout?: number;
}

/** Deterministic shuffle, so the blocks come in no useful order. */
function shuffle<T>(items: T[], seed = 3): T[] {
  let state = seed;
  for (let i = items.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

export async function writeCar(roots: CID[], blocks: readonly Block[]): Promise<Buffer> {
  const { writer, out } = CarWriter.create(roots);
  const chunks: Uint8Array[] = [];
  const collected = (async () => {
    for await (const chunk of out) chunks.push(chunk);
  })();
  for (const block of blocks) await writer.put(block);
  await writer.close();
  await collected;
  return Buffer.concat(chunks);
}

export async function buildBlueskyArchive(options: BlueskyOptions = {}): Promise<Buffer> {
  const posts = options.posts ?? Object.values(BLUESKY_POSTS);
  const blocks: Block[] = [];
  const leaves: Leaf[] = [];
  const record = (key: string, value: unknown, corrupt = false) => {
    const block = cborBlock(value);
    if (corrupt) {
      const bytes = Uint8Array.from(block.bytes);
      bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
      blocks.push({ cid: block.cid, bytes });
    } else blocks.push(block);
    leaves.push({ key, cid: block.cid });
  };
  record("app.bsky.actor.profile/self", { $type: "app.bsky.actor.profile", displayName: CANARY.name, description: `${CANARY.handle} profile` });
  record("app.bsky.feed.like/3kbbbbbbbbb01", { $type: "app.bsky.feed.like", subject: strongRef(atUri("3kzzzzzzzzz96", OTHER_DID)), createdAt: "2023-04-01T00:00:00Z", note: CANARY.like });
  for (const spec of posts) record(`app.bsky.feed.post/${spec.rkey}`, postRecord(spec), spec.rkey === options.corruptPost);
  record("app.bsky.feed.repost/3kccccccccc01", { $type: "app.bsky.feed.repost", subject: strongRef(atUri("3kzzzzzzzzz95", OTHER_DID)), createdAt: "2023-04-01T00:00:00Z" });
  record("app.bsky.graph.follow/3kddddddddd01", { $type: "app.bsky.graph.follow", subject: OTHER_DID, createdAt: "2023-04-01T00:00:00Z", via: CANARY.like });
  leaves.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const mstBlocks: Block[] = [];
  const data = buildMst(leaves, options.fanout ?? 4, mstBlocks);
  for (const block of mstBlocks) if (!(options.dropMstRoot === true && block.cid.equals(data))) blocks.push(block);
  const commit = cborBlock({ did: FIXTURE_DID, version: options.commitVersion ?? 3, data, rev: "3kcommitrev01", prev: null, sig: new Uint8Array(64) });
  if (options.corruptCommit === true) {
    const bytes = Uint8Array.from(commit.bytes);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    blocks.push({ cid: commit.cid, bytes });
  } else blocks.push(commit);
  // A block outside the tree: never reached, never decoded.
  blocks.push(cborBlock({ $type: "chat.bsky.convo.message", text: `${CANARY.dm} outside the tree` }));
  if (options.bigBlock === true) blocks.push(rawBlock(new Uint8Array(1_000_001)));
  const roots = options.twoRoots === true ? [commit.cid, data] : [commit.cid];
  return writeCar(roots, shuffle(blocks));
}
