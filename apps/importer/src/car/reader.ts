import { createHash } from "node:crypto";
import { readSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { CarIndexer } from "@ipld/car/indexer";
import * as dagCbor from "@ipld/dag-cbor";
import { CID } from "multiformats/cid";
import { IMPORT_RULES } from "@korbat/contracts";
import { ScanFailure, field, type CarArchive, type CarRecord } from "../adapters/types";
import { readAt } from "../zip/central";
import { MST_LIMITS, POST_COLLECTION, walkPosts } from "./mst";

/**
 * The CAR reader (3b design, 5.7): a Bluesky repository export read in two passes, since a CAR's blocks come in any
 * order. Pass 1, with @ipld/car's CarIndexer, records each block's offset and length without decoding it, refusing a
 * block over 1,000,000 bytes and more than 2,000,000 blocks; the index is keyed by the first 8 bytes of each block's
 * SHA-256 digest in typed arrays (about 16 bytes a slot), never by a CID's string, so 2,000,000 blocks fit in tens of
 * megabytes. Then the commit is decoded and the MST walked (mst.ts), and each post record is read and decoded with
 * @ipld/dag-cbor when the walk reaches its key. Every block decoded is first hashed with node:crypto and compared with
 * its CID's SHA-256 digest; a mismatch is unreadable.
 */

const SHA2_256 = 0x12;
const DAG_CBOR = 0x71;
const DIGEST_BYTES = 32;
/** One read of pass 1. */
const READ_BYTES = 1_048_576;
/** The CAR's one pseudo-entry, as detect sees it. */
export const CAR_ENTRY = "repo.car";
const RKEY = /^[A-Za-z0-9._:~-]{1,512}$/;

export interface CarLimits {
  maxBlocks: number;
  blockMaxBytes: number;
}

const CAR_LIMITS: Readonly<CarLimits> = { maxBlocks: IMPORT_RULES.carMaxBlocks, blockMaxBytes: IMPORT_RULES.carBlockMaxBytes };

/** The unsigned varint at the start of `bytes`, and its length; null when it does not end within 9 bytes. */
function varint(bytes: Uint8Array): [number, number] | null {
  let value = 0;
  for (let i = 0; i < bytes.length && i < 9; i++) {
    value += (bytes[i]! & 0x7f) * 2 ** (7 * i);
    if ((bytes[i]! & 0x80) === 0) return [value, i + 1];
  }
  return null;
}

/** A CAR's first bytes: a varint header length within the block cap, then a CBOR map (major type 5). */
export function looksLikeCar(head: Uint8Array, maxHeader: number = CAR_LIMITS.blockMaxBytes): boolean {
  const read = varint(head);
  if (!read) return false;
  const [length, used] = read;
  return length > 0 && length <= maxHeader && head.length > used && head[used]! >> 5 === 5;
}

const LOAD = 0.7;
const VISITED = 0x80000000;

/** Each block's place in the file, by the first 8 bytes of its SHA-256 digest: open addressing over typed arrays. */
export class BlockIndex {
  private capacity: number;
  private count = 0;
  private hi: Uint32Array;
  private lo: Uint32Array;
  private offsets: Uint32Array;
  /** The block's length plus one (0: an empty slot), with VISITED once the walk took the block. */
  private lengths: Uint32Array;

  constructor(capacity = 1 << 16) {
    this.capacity = capacity;
    this.hi = new Uint32Array(capacity);
    this.lo = new Uint32Array(capacity);
    this.offsets = new Uint32Array(capacity);
    this.lengths = new Uint32Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  private static key(digest: Uint8Array): [number, number] {
    return [((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0, ((digest[4]! << 24) | (digest[5]! << 16) | (digest[6]! << 8) | digest[7]!) >>> 0];
  }

  /** The slot holding `hi:lo`, or the empty slot where it would go. */
  private slot(hi: number, lo: number): number {
    const mask = this.capacity - 1;
    let at = lo & mask;
    while (this.lengths[at] !== 0 && (this.hi[at] !== hi || this.lo[at] !== lo)) at = (at + 1) & mask;
    return at;
  }

  private grow(): void {
    const { hi, lo, offsets, lengths, capacity } = this;
    this.capacity = capacity * 2;
    this.hi = new Uint32Array(this.capacity);
    this.lo = new Uint32Array(this.capacity);
    this.offsets = new Uint32Array(this.capacity);
    this.lengths = new Uint32Array(this.capacity);
    for (let i = 0; i < capacity; i++) {
      if (lengths[i] === 0) continue;
      const at = this.slot(hi[i]!, lo[i]!);
      this.hi[at] = hi[i]!;
      this.lo[at] = lo[i]!;
      this.offsets[at] = offsets[i]!;
      this.lengths[at] = lengths[i]!;
    }
  }

  /** Records a block; the first of two blocks with one digest prefix stays (a wrong one fails its hash check when read). */
  put(digest: Uint8Array, offset: number, length: number): void {
    if ((this.count + 1) / this.capacity > LOAD) this.grow();
    const [hi, lo] = BlockIndex.key(digest);
    const at = this.slot(hi, lo);
    if (this.lengths[at] !== 0) return;
    this.hi[at] = hi;
    this.lo[at] = lo;
    this.offsets[at] = offset;
    this.lengths[at] = length + 1;
    this.count++;
  }

  find(digest: Uint8Array): { offset: number; length: number; slot: number } | null {
    const [hi, lo] = BlockIndex.key(digest);
    const at = this.slot(hi, lo);
    const stored = this.lengths[at]!;
    if (stored === 0) return null;
    return { offset: this.offsets[at]!, length: (stored & ~VISITED) - 1, slot: at };
  }

  /** Marks a slot visited; false when it already was. */
  visit(slot: number): boolean {
    const stored = this.lengths[slot]!;
    if ((stored & VISITED) !== 0) return false;
    this.lengths[slot] = (stored | VISITED) >>> 0;
    return true;
  }
}

async function* fileChunks(handle: FileHandle, size: number): AsyncGenerator<Uint8Array> {
  for (let position = 0; position < size; position += READ_BYTES) {
    const chunk = await readAt(handle, position, Math.min(READ_BYTES, size - position));
    if (chunk.length === 0) return;
    yield chunk;
  }
}

const isSha256 = (cid: CID) => cid.multihash.code === SHA2_256 && cid.multihash.digest.length === DIGEST_BYTES;

export interface OpenCarOptions {
  /** Tests only: smaller limits than IMPORT_RULES's. */
  limits?: Partial<CarLimits>;
}

/** Pass 1 and the commit; the records are read as the caller iterates `records()`. */
export async function openCar(handle: FileHandle, size: number, options: OpenCarOptions = {}): Promise<CarArchive> {
  const limits: CarLimits = { ...CAR_LIMITS, ...options.limits };
  // The header's length is checked before @ipld/car reads it, which would otherwise gather any length it is told.
  const head = await readAt(handle, 0, 16);
  if (!looksLikeCar(head, limits.blockMaxBytes)) throw new ScanFailure("not_an_archive");
  let indexer: CarIndexer;
  try {
    indexer = await CarIndexer.fromIterable(fileChunks(handle, size));
  } catch {
    throw new ScanFailure("not_an_archive");
  }
  const roots = await indexer.getRoots();
  if (indexer.version !== 1 || roots.length !== 1) throw new ScanFailure("not_this_source");

  const index = new BlockIndex();
  let blocks = 0;
  try {
    for await (const block of indexer) {
      blocks++;
      if (blocks > limits.maxBlocks) throw new ScanFailure("too_many_entries");
      if (block.blockLength > limits.blockMaxBytes) throw new ScanFailure("unreadable");
      if (isSha256(block.cid)) index.put(block.cid.multihash.digest, block.blockOffset, block.blockLength);
    }
  } catch (err) {
    // @ipld/car's own errors (a truncated section, a bad CID) carry text of the input: only the code is kept.
    throw err instanceof ScanFailure ? err : new ScanFailure("unreadable");
  }

  /**
   * A block's bytes, checked against its CID's digest; null when it is absent or does not match. Blocks are at most
   * 1,000,000 bytes and read one after another, so each is read synchronously from the open descriptor: a round trip
   * through the thread pool for every one of a million small reads would leave the process mostly waiting.
   */
  const blockBytes = async (cid: CID): Promise<Uint8Array | null> => {
    if (!isSha256(cid) || cid.code !== DAG_CBOR) return null;
    const found = index.find(cid.multihash.digest);
    if (!found) return null;
    const bytes = Buffer.alloc(found.length);
    let filled = 0;
    while (filled < found.length) {
      const read = readSync(handle.fd, bytes, filled, found.length - filled, found.offset + filled);
      if (read === 0) return null;
      filled += read;
    }
    const digest = createHash("sha256").update(bytes).digest();
    return digest.equals(cid.multihash.digest) ? bytes : null;
  };
  const decode = (bytes: Uint8Array): unknown => {
    try {
      return dagCbor.decode(bytes);
    } catch {
      return undefined;
    }
  };

  const root = roots[0]!;
  const commitBytes = await blockBytes(root);
  if (!commitBytes) throw new ScanFailure("unreadable");
  const commit = decode(commitBytes);
  const did = field(commit, "did");
  const data = CID.asCID(field(commit, "data"));
  if (typeof did !== "string" || !did.startsWith("did:") || field(commit, "version") !== 3 || data === null) throw new ScanFailure("not_this_source");

  const source = {
    visit: (cid: CID) => {
      const found = isSha256(cid) ? index.find(cid.multihash.digest) : null;
      if (!found) throw new ScanFailure("unreadable");
      return index.visit(found.slot);
    },
    node: async (cid: CID) => {
      const bytes = await blockBytes(cid);
      const node = bytes ? decode(bytes) : undefined;
      if (node === undefined) throw new ScanFailure("unreadable");
      return node;
    },
  };

  async function* records(): AsyncGenerator<CarRecord> {
    for await (const { key, cid } of walkPosts(data!, source, MST_LIMITS)) {
      const bytes = RKEY.test(key.slice(POST_COLLECTION.length)) ? await blockBytes(cid) : null;
      const value = bytes ? decode(bytes) : undefined;
      if (value === undefined) {
        yield { unreadable: true };
        continue;
      }
      // The DID stays in memory: it makes the source id the key is computed from, and is never written.
      yield { uri: `at://${did as string}/${key}`, value };
    }
  }

  return { kind: "car", entries: [{ name: CAR_ENTRY, size }], did, records };
}
