import { CID } from "multiformats/cid";
import { IMPORT_RULES } from "@korbat/contracts";
import { ScanFailure, field, isRecord } from "../adapters/types";

/**
 * The walk of a Bluesky repository's Merkle Search Tree (3b design, 5.7), from the commit's `data`: at most 48 levels,
 * at most 4,096 entries a node, every node visited once (a crafted tree that names one node twice would otherwise make
 * the walk exponential). A node is `{ l, e }`: `l` the subtree before its first entry, each entry `{ p, k, v, t }` with
 * its key prefix-compressed as atproto's repository spec writes it (`p` bytes shared with the previous entry's key in
 * the node, then `k`), `v` the record's CID and `t` the subtree after it. Only the CIDs of keys under
 * app.bsky.feed.post/ are handed on; no other record is decoded.
 */

export const POST_COLLECTION = "app.bsky.feed.post/";
const UTF8 = new TextDecoder("utf-8", { fatal: true });

export interface MstLimits {
  maxDepth: number;
  maxEntries: number;
}

export const MST_LIMITS: Readonly<MstLimits> = { maxDepth: IMPORT_RULES.mstMaxDepth, maxEntries: IMPORT_RULES.mstMaxEntries };

export interface MstSource {
  /** Marks a node visited; false when it already was. */
  visit(cid: CID): boolean;
  /** The node's decoded value, checked against its CID; throws ScanFailure("unreadable") when it cannot be had. */
  node(cid: CID): Promise<unknown>;
}

const asCid = (value: unknown) => (value === null || value === undefined ? null : CID.asCID(value));

/** The post keys of the tree in key order, each with its record's CID. A broken tree is unreadable. */
export async function* walkPosts(root: CID, source: MstSource, limits: MstLimits = MST_LIMITS): AsyncGenerator<{ key: string; cid: CID }> {
  async function* walk(cid: CID, depth: number): AsyncGenerator<{ key: string; cid: CID }> {
    if (depth > limits.maxDepth) throw new ScanFailure("unreadable");
    if (!source.visit(cid)) return;
    const node = await source.node(cid);
    const entries = field(node, "e");
    const left = field(node, "l");
    if (!isRecord(node) || !Array.isArray(entries) || entries.length > limits.maxEntries) throw new ScanFailure("unreadable");
    const leftCid = asCid(left);
    if (left !== null && left !== undefined && leftCid === null) throw new ScanFailure("unreadable");
    if (leftCid) yield* walk(leftCid, depth + 1);
    let previous = new Uint8Array(0);
    for (const entry of entries) {
      const shared = field(entry, "p");
      const rest = field(entry, "k");
      const value = asCid(field(entry, "v"));
      const rightRaw = field(entry, "t");
      const right = asCid(rightRaw);
      if (typeof shared !== "number" || !Number.isInteger(shared) || shared < 0 || shared > previous.length || !(rest instanceof Uint8Array) || value === null) {
        throw new ScanFailure("unreadable");
      }
      if (rightRaw !== null && rightRaw !== undefined && right === null) throw new ScanFailure("unreadable");
      const key = new Uint8Array(shared + rest.length);
      key.set(previous.subarray(0, shared), 0);
      key.set(rest, shared);
      previous = key;
      let name: string | null;
      try {
        name = UTF8.decode(key);
      } catch {
        name = null;
      }
      if (name !== null && name.startsWith(POST_COLLECTION)) yield { key: name, cid: value };
      if (right) yield* walk(right, depth + 1);
    }
  }
  yield* walk(root, 1);
}
