import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { Deflate, strFromU8, unzipSync } from "fflate";
import { Hono, type MiddlewareHandler } from "hono";
import pino from "pino";
import { afterAll, describe, expect, test, vi } from "vitest";
import { ACTIVITY_DEFAULTS, ExportFormat, STANDING_RULES } from "@korbat/contracts";
import { MAX_VARIANT_BYTES } from "@korbat/media-protocol";
import { AccountError, type AccountDeps } from "../../src/account/context";
import type { ReceivedEntry } from "../../src/activity";
import { EXPORT_WINDOW_MS, buildExport, enforceExportLimit, exportFilename, exportJson, mediaEntry, writeExport } from "../../src/account/flows/export";
import { accountRoutes } from "../../src/account/routes";
import { createZipWriter, type OpenFile } from "../../src/account/zip";
import type { AccountExport, AuthEventType, Session } from "../../src/auth";
import type { ImportRecord } from "../../src/imports";
import type { AppEnv } from "../../src/env";
import { createMediaFiles } from "../../src/media/files";
import { MemoryStore } from "../../src/middleware/rate-limit";
import type { ModerationExport } from "../../src/moderation";
import type { ExportedPost } from "../../src/social";
import type { HandleRefRow, PostRefRow } from "../../src/social/repo";

const root = mkdtempSync(path.join(tmpdir(), "korbat-account-export-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T0 = 1_789_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const silent = pino({ level: "silent" });
const KIB64 = 64 * 1024;
const TWO_32 = 0x1_0000_0000;

/** A file of the given bytes in a fresh directory, and its absolute path. */
function fileOf(bytes: Uint8Array): string {
  const dir = path.join(root, randomUUID());
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "large.webp");
  writeFileSync(file, bytes);
  return file;
}

/** Opens a file as the media module's checked open answers: the handle with the size it measured, or null for no plain file. */
function openerOf(file: string): OpenFile {
  return async () => {
    let handle: FileHandle;
    try {
      handle = await open(file, "r");
    } catch {
      return null;
    }
    const stats = await handle.stat();
    if (stats.isFile()) return { handle, size: stats.size };
    await handle.close();
    return null;
  };
}

/**
 * Collects the archive in memory. Every write takes a turn of the event loop, and a write that
 * starts while another is still pending is remembered: the writer must await each one.
 */
function memorySink() {
  const chunks: Uint8Array[] = [];
  let busy = false;
  let overlapped = false;
  return {
    async write(chunk: Uint8Array): Promise<void> {
      if (busy) overlapped = true;
      busy = true;
      await new Promise((resolve) => setTimeout(resolve, 0));
      chunks.push(Uint8Array.from(chunk));
      busy = false;
    },
    bytes: (): Buffer => Buffer.concat(chunks),
    get overlapped() {
      return overlapped;
    },
    get count() {
      return chunks.length;
    },
  };
}

/**
 * A stand-in for an opened store file: `size` bytes of `chunk` (zeros unless given), yielded lazily in
 * chunks of its length, failing once `failAfter` chunks were read when asked to. It records how many
 * chunks were read, whether the reading stopped and whether the handle was closed.
 */
function fakeFile(size: number, options: { failAfter?: number; chunk?: Uint8Array } = {}) {
  const chunk = options.chunk ?? new Uint8Array(KIB64);
  const state = { chunks: 0, stopped: false, closed: false };
  const handle = {
    createReadStream({ start = 0, end = size - 1 }: { start?: number; end?: number }): AsyncIterable<Uint8Array> {
      return (async function* () {
        try {
          for (let at = start; at <= end; at += chunk.length) {
            if (options.failAfter !== undefined && state.chunks >= options.failAfter) throw new Error("the disk failed in the middle of the file");
            state.chunks += 1;
            yield at + chunk.length - 1 <= end ? chunk : chunk.subarray(0, end - at + 1);
          }
        } finally {
          state.stopped = true;
        }
      })();
    },
    async close() {
      state.closed = true;
    },
  };
  const opener: OpenFile = async () => ({ handle: handle as unknown as FileHandle, size });
  return { open: opener, state, chunk };
}

async function collect(pieces: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const piece of pieces) out.push(piece);
  return out;
}

async function* piecesOf(...pieces: string[]): AsyncGenerator<string> {
  yield* pieces;
}

/** One central directory entry as a reader finds it. */
interface CentralEntry {
  at: number;
  name: string;
  method: number;
  versionNeeded: number;
  flags: number;
  compressed: number;
  size: number;
  offset: number;
  /** The payload of the ZIP64 extra field (id 0x0001), as 64-bit values, or null without one. */
  zip64: number[] | null;
}

const u64 = (bytes: Buffer, at: number) => bytes.readUInt32LE(at) + bytes.readUInt32LE(at + 4) * TWO_32;

/** Every central directory entry in archive order, found by its signature (none of the test data holds it). */
function centralDirectory(archive: Uint8Array, base = 0): CentralEntry[] {
  const bytes = Buffer.from(archive);
  const entries: CentralEntry[] = [];
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (bytes.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = bytes.readUInt16LE(i + 28);
    const extraLength = bytes.readUInt16LE(i + 30);
    let zip64: number[] | null = null;
    for (let at = i + 46 + nameLength; at + 4 <= i + 46 + nameLength + extraLength; at += 4 + bytes.readUInt16LE(at + 2)) {
      if (bytes.readUInt16LE(at) !== 0x0001) continue;
      const length = bytes.readUInt16LE(at + 2);
      zip64 = Array.from({ length: length / 8 }, (_, k) => u64(bytes, at + 4 + 8 * k));
    }
    entries.push({
      at: base + i,
      name: bytes.toString("utf8", i + 46, i + 46 + nameLength),
      method: bytes.readUInt16LE(i + 10),
      versionNeeded: bytes.readUInt16LE(i + 6),
      flags: bytes.readUInt16LE(i + 8),
      compressed: bytes.readUInt32LE(i + 20),
      size: bytes.readUInt32LE(i + 24),
      offset: bytes.readUInt32LE(i + 42),
      zip64,
    });
  }
  return entries;
}

/** The end records, read from the archive's last bytes as a reader does: the classic one, then the ZIP64 locator and record when present. */
function endRecords(archive: Uint8Array, base = 0) {
  const bytes = Buffer.from(archive);
  const at = bytes.length - 22;
  expect(bytes.readUInt32LE(at)).toBe(0x06054b50);
  const end = { entriesHere: bytes.readUInt16LE(at + 8), entries: bytes.readUInt16LE(at + 10), size: bytes.readUInt32LE(at + 12), offset: bytes.readUInt32LE(at + 16), comment: bytes.readUInt16LE(at + 20) };
  if (at < 20 || bytes.readUInt32LE(at - 20) !== 0x07064b50) return { end, locator: null, end64: null };
  const locator = { disk: bytes.readUInt32LE(at - 16), offset: u64(bytes, at - 12), disks: bytes.readUInt32LE(at - 4) };
  const r = locator.offset - base;
  expect(bytes.readUInt32LE(r)).toBe(0x06064b50);
  const end64 = {
    at: base + r,
    recordSize: u64(bytes, r + 4),
    versionMadeBy: bytes.readUInt16LE(r + 12),
    versionNeeded: bytes.readUInt16LE(r + 14),
    disk: bytes.readUInt32LE(r + 16),
    directoryDisk: bytes.readUInt32LE(r + 20),
    entriesHere: u64(bytes, r + 24),
    entries: u64(bytes, r + 32),
    size: u64(bytes, r + 40),
    offset: u64(bytes, r + 48),
  };
  return { end, locator, end64 };
}

interface RecordedEvent {
  userId: string;
  type: AuthEventType;
  metadata: Record<string, unknown> | undefined;
}

interface Lists {
  posts: ExportedPost[];
  likes: PostRefRow[];
  reposts: PostRefRow[];
  bookmarks: PostRefRow[];
  following: HandleRefRow[];
  blocks: HandleRefRow[];
  mutes: HandleRefRow[];
  /** 2d (11.2): the Activity entries the account received, newest first, as the activity module hands them over. */
  received: ReceivedEntry[];
}

/**
 * The export flow on fakes of the three module interfaces: an account with two live sessions, one
 * device and two events; a profile with a post carrying two images and a deleted reply, one like, one
 * bookmark, a follow, a block and a mute; and whatever images the test puts in `images`. The social
 * fake hands each list out in pages of the size it is asked for, reading a page only when it is
 * iterated, and records every read in `reads`; a test may add rows to `lists`. `failures` makes the
 * next calls of a module read throw.
 */
function harness() {
  let t = T0;
  const images: { id: string; open: OpenFile }[] = [];
  const userId = randomUUID();
  // Sessions are named by their handles, as the auth module's export lists them; the hash of a token is in no part of the archive.
  const currentSession = randomUUID();
  const otherSession = randomUUID();
  const [postId, deletedId, likedId, bookmarkedId, imageA, imageB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const events: RecordedEvent[] = [];
  const reads: string[] = [];
  const failures = { exportAccount: 0, exportFor: 0 };
  /** The accounts the moderation module was asked about, in order. */
  const asked: string[] = [];
  // What the moderation module hands over for the account: a removal of the post with its texts and an answered appeal,
  // a correction about the account that carries no text, and one report with a released item and a waiting one. Every
  // object's members stand in another order than the format's, and the first decision carries a member the format does
  // not have: the account module writes the format's members in the format's order, and nothing else.
  const [removalId, correctionId, reportedPost, orderedId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  // 3d review L14 (people12): an order's notice as its author was told it, with 3f's three members, the order's facts, the
  // authority's words and the day of an erasure, each in another order than the format's.
  const ordered = {
    objection: null,
    signal: null,
    automatedDecision: "not_automated",
    automatedDetection: false,
    erasedOn: "2026-09-14",
    orderTexts: { reasonsAt: "2026-09-13T10:00:00.000Z", textsAt: "2026-09-13T10:00:00.000Z", scope: null, redress: "Court of Example", reasons: "The post incites violence." },
    order: {
      orderGround: null,
      preserveEndedOn: "2026-09-14",
      preserveExtended: false,
      preserveFirstUntil: null,
      preserveUntil: null,
      holdEndReason: null,
      informedAt: "2026-09-13T10:00:00.000Z",
      held: false,
      disabledAt: "2026-09-13T09:30:00.000Z",
      withholdAuthor: false,
      homeState: null,
      crossBorder: false,
      orderedFrom: "issued",
      orderedOn: "2026-09-13",
      verified: true,
      reference: "AZ 1/26",
      authority: "Example Police",
      memberState: "DE",
      kind: "tco_removal",
    },
    appeal: null,
    legalReference: null,
    reason: null,
    facts: null,
    reversals: [],
    measures: [],
    rulesVersion: 2,
    ruleId: null,
    ground: "illegal",
    outcome: "restricted",
    kind: "order",
    postId: null,
    decidedOn: "2026-09-13",
    id: orderedId,
  } satisfies ModerationExport["decisions"][number];
  const removal = {
    // 3d (W.10): what the statement says of automated means and the objection, first, in another order than the format's.
    objection: null,
    signal: null,
    automatedDecision: "not_automated",
    automatedDetection: false,
    appeal: { result: "kept", state: "answered" },
    legalReference: null,
    reason: "That is an attack on people for what they are.",
    facts: "The post calls for a named group to be excluded.",
    reversals: [],
    measures: [
      { noEffect: null, mediaId: null, kind: "remove" },
      { noEffect: "already", mediaId: imageA, kind: "remove_media" },
    ],
    rulesVersion: 2,
    ruleId: "R3",
    ground: "incompatible",
    outcome: "restricted",
    kind: "final",
    postId,
    decidedOn: "2026-09-12",
    id: removalId,
    decidedBy: "a staff member the export must never name",
  } satisfies ModerationExport["decisions"][number] & { decidedBy: string };
  const moderation: ModerationExport = {
    // 3d (W.10): a refused upload and a release, each object's members in another order than the format's.
    releases: [{ upload: true, releasedAt: new Date(T0 - DAY_MS).toISOString(), basis: "leave", id: correctionId }],
    uploads: [
      { reportKept: true, released: new Date(T0 - DAY_MS).toISOString(), endReason: null, endAs: "report", endedAt: new Date(T0 - 2 * DAY_MS).toISOString(), mayObject: false, objection: { objectedAt: new Date(T0 - 2 * DAY_MS).toISOString(), text: "It is my own photo." }, listedAs: "csam", matchKind: "exact", source: "test", refusedAt: new Date(T0 - 3 * DAY_MS).toISOString(), id: removalId },
    ],
    // 3e (W.8): the report counts, a reply and a suspension at once that a correction lifted, each object's members in
    // another order than the format's.
    reporting: {
      markedReports: 1,
      marks: [{ counts: true, withdrawnAt: null, markedAt: new Date(T0 - DAY_MS).toISOString(), sentOn: "2026-09-11", position: 1, ref: "N-ABCDEFGH24" }],
      days: [{ reports: 2, day: "2026-09-11" }],
      frameDays: 90,
    },
    replies: [{ answeredBy: correctionId, answeredAt: new Date(T0 - DAY_MS).toISOString(), erasedAt: null, text: "I did not write that post.", onTime: false, filedAt: new Date(T0 - 2 * DAY_MS).toISOString(), decisionId: removalId }],
    standing: [
      {
        basisEndedBy: null,
        basisEndedAt: null,
        replaced: false,
        liftedBy: correctionId,
        liftedAt: new Date(T0 - DAY_MS).toISOString(),
        endsAt: new Date(T0 - DAY_MS).toISOString(),
        startsAt: new Date(T0 - 3 * DAY_MS).toISOString(),
        earliestStart: new Date(T0 - 3 * DAY_MS).toISOString(),
        decidedAt: new Date(T0 - 3 * DAY_MS).toISOString(),
        announced: false,
        days: 7,
        basis: "threat",
        kind: "suspend",
        decisionId: removalId,
      },
    ],
    strikes: [],
    reports: [
      {
        items: [
          { reexaminationOpen: true, outcomeText: "no action: korbat found no breach of its rules and nothing illegal.", outcome: "no_violation", reexamines: false, link: `http://localhost:8081/post/${reportedPost}`, position: 1 },
          { reexaminationOpen: null, outcomeText: null, outcome: null, reexamines: false, link: "http://localhost:8081/u/bob", position: 2 },
        ],
        explanation: "It offers a fake giveaway.",
        category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
        ruleId: null,
        ground: "illegal",
        receivedAt: new Date(T0 - DAY_MS).toISOString(),
        ref: "N-ABCDEFGH23",
      },
    ],
    decisions: [
      removal,
      { objection: null, signal: null, automatedDecision: "not_automated", automatedDetection: false, appeal: null, legalReference: null, reason: null, facts: null, reversals: [{ mediaId: null, kind: "restore_bio" }], measures: [], rulesVersion: 2, ruleId: null, ground: null, outcome: "reversed", kind: "correction", postId: null, decidedOn: "2026-09-10", id: correctionId },
      ordered,
    ],
  };
  // The deletion side of the three interfaces is not exercised by the export; test/account/deletion.test.ts covers it.
  const notHere = async (): Promise<never> => {
    throw new Error("not exercised by the export");
  };
  const account: AccountExport = {
    account: { id: userId, email: "ada@korbat.local", createdAt: new Date(T0 - 3 * DAY_MS), role: "user", mfaEnabled: true, hasPassword: false, verified: true, termsVersion: "draft-test", termsAcceptedAt: new Date(T0 - 3 * DAY_MS) },
    // Newest first, as the auth module lists them: a plain key never used, added from a device since gone, and a synced one used yesterday.
    passkeys: [
      { name: "Security key", createdAt: new Date(T0 - DAY_MS), lastUsedAt: null, synced: false, createdOn: null },
      { name: "Laptop", createdAt: new Date(T0 - 2 * DAY_MS), lastUsedAt: new Date(T0 - DAY_MS), synced: true, createdOn: "Chrome on Windows" },
    ],
    sessions: [
      { id: otherSession, createdAt: new Date(T0 - 2 * DAY_MS), lastUsedAt: new Date(T0 - DAY_MS) },
      { id: currentSession, createdAt: new Date(T0 - DAY_MS), lastUsedAt: new Date(T0) },
    ],
    devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: new Date(T0 - 3 * DAY_MS), lastSeenAt: new Date(T0) }],
    events: [
      { type: "signin_success", at: new Date(T0 - DAY_MS) },
      { type: "signup", at: new Date(T0 - 3 * DAY_MS) },
    ],
  };
  const lists: Lists = {
    posts: [
      {
        id: postId,
        body: "two photos",
        createdAt: new Date(T0 - 2 * DAY_MS),
        replyToId: null,
        quoteOfId: null,
        state: "visible",
        deletedAt: null,
        media: [
          { id: imageA, altText: "a harbour at dawn", width: 1600, height: 1200 },
          { id: imageB, altText: "a lighthouse", width: 900, height: 1600 },
        ],
        imported: null,
        // 2d (11.2): two stored mentions as written, one of an account renamed since, and the counts hidden.
        mentions: ["bob", "old_name"],
        countsHidden: true,
      },
      { id: deletedId, body: "", createdAt: new Date(T0 - DAY_MS), replyToId: postId, quoteOfId: null, state: "deleted_by_author", deletedAt: new Date(T0 - 1_000), media: [], imported: null, mentions: [], countsHidden: false },
    ],
    likes: [{ postId: likedId, at: new Date(T0 - DAY_MS) }],
    reposts: [],
    bookmarks: [{ postId: bookmarkedId, at: new Date(T0 - 500) }],
    following: [{ handle: "bob", since: new Date(T0 - 2 * DAY_MS) }],
    blocks: [{ handle: "eve", since: new Date(T0 - DAY_MS) }],
    mutes: [{ handle: "carol", since: new Date(T0 - 200) }],
    // 2d (11.2): a reply shown, a mention from a muted account, and a follow that is gone, each object's members in
    // another order than the format's.
    received: [
      { shown: true, actorHandle: "bob", postId: likedId, at: "2026-09-21T10:00:00.000002Z", kind: "reply" },
      { shown: "muted", actorHandle: "carol", postId: bookmarkedId, at: "2026-09-21T09:00:00.000001Z", kind: "mention" },
      { shown: "unfollowed", actorHandle: "dave", postId: null, at: "2026-09-20T09:00:00.000000Z", kind: "follow" },
    ] as ReceivedEntry[],
  };
  /** A list in pages of `pageSize`, each read when the one before has been used, as the social module pages its keyset reads. */
  function paged<T>(name: keyof Lists, rows: T[], pageSize: number): AsyncIterable<T[]> {
    return {
      async *[Symbol.asyncIterator]() {
        for (let at = 0; ; at += pageSize) {
          reads.push(name);
          const page = rows.slice(at, at + pageSize);
          if (page.length > 0) yield page;
          if (page.length < pageSize) return;
        }
      },
    };
  }
  /** 3b Task 6: none unless a test adds some. */
  const imports: ImportRecord[] = [];
  const deps: AccountDeps = {
    auth: {
      startDeletion: notHere,
      confirmDeletion: notHere,
      pendingPurges: notHere,
      finishPurge: notHere,
      takeDownTerminated: notHere,
      exportAccount: async () => {
        if (failures.exportAccount > 0) {
          failures.exportAccount -= 1;
          throw new Error("the auth pool timed out");
        }
        return account;
      },
      appendEvent: async (id, type, metadata) => {
        events.push({ userId: id, type, metadata });
      },
    },
    social: {
      purgeProfile: notHere,
      exportProfile: async (_id, pageSize = 1000) => ({
        // The Explore switch is off, not the column's default, so the export is seen to carry what the profile holds.
        // 2d: link previews on, not the column's default, for the same reason.
        profile: {
          handle: "ada",
          displayName: "Ada",
          bio: "Analytical engines.",
          createdAt: new Date(T0 - 3 * DAY_MS),
          handleHistory: ["ada_old", "ada"],
          showInExplore: false,
          retiredHandles: [{ handle: "ada_old", retiredAt: new Date(T0 - DAY_MS) }],
          sharePreviews: true,
        },
        posts: paged("posts", lists.posts, pageSize),
        likes: paged("likes", lists.likes, pageSize),
        reposts: paged("reposts", lists.reposts, pageSize),
        bookmarks: paged("bookmarks", lists.bookmarks, pageSize),
        following: paged("following", lists.following, pageSize),
        blocks: paged("blocks", lists.blocks, pageSize),
        mutes: paged("mutes", lists.mutes, pageSize),
      }),
    },
    media: { purgeOwner: notHere, requestDeletion: notHere, exportImages: async () => images },
    // 3b Task 6: the account's imports, newest first, as the imports module hands them over (11.2).
    imports: { purgeOwner: notHere, removeFiles: notHere, exportFor: async () => imports },
    // 2d (11.2): the account's Activity: the marker and the rules at once, the received entries in pages as they are written.
    activity: {
      exportEntries: async (_id, pageSize = 1000) => ({
        seenAt: "2026-09-21T09:30:00.123456Z",
        settings: { follows: false, quotes: "off", mentions: "following", replies: "older" },
        received: paged("received", lists.received, pageSize),
      }),
    },
    moderation: {
      forgetAccount: notHere,
      takeDownDue: notHere,
      exportFor: async (id) => {
        asked.push(id);
        if (failures.exportFor > 0) {
          failures.exportFor -= 1;
          throw new Error("the API pool timed out");
        }
        return moderation;
      },
    },
    limits: new MemoryStore(() => t),
    log: silent,
    now: () => new Date(t),
  };
  return {
    deps,
    moderation,
    asked,
    removalId,
    correctionId,
    orderedId,
    reportedPost,
    userId,
    currentSession,
    otherSession,
    postId,
    deletedId,
    likedId,
    bookmarkedId,
    imageA,
    imageB,
    images,
    events,
    lists,
    imports,
    reads,
    failures,
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

type Harness = ReturnType<typeof harness>;

/** export.json as a document in memory, built from the harness's rows the way the export describes them, for JSON.stringify to write. */
function expectedDocument(h: Harness, missingMedia: string[] = []) {
  const ref = (row: PostRefRow) => ({ postId: row.postId, at: row.at.toISOString() });
  const other = (row: HandleRefRow) => ({ handle: row.handle, since: row.since.toISOString() });
  return {
    format: "korbat-export-1",
    exportedAt: iso(T0),
    account: {
      id: h.userId,
      email: "ada@korbat.local",
      createdAt: iso(T0 - 3 * DAY_MS),
      role: "user",
      mfaEnabled: true,
      hasPassword: false,
      verified: true,
      termsVersion: "draft-test",
      termsAcceptedAt: iso(T0 - 3 * DAY_MS),
      passkeys: [
        { name: "Security key", createdAt: iso(T0 - DAY_MS), lastUsedAt: null, synced: false, createdOn: null },
        { name: "Laptop", createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), synced: true, createdOn: "Chrome on Windows" },
      ],
    },
    profile: {
      handle: "ada",
      displayName: "Ada",
      bio: "Analytical engines.",
      createdAt: iso(T0 - 3 * DAY_MS),
      handleHistory: ["ada_old", "ada"],
      showInExplore: false,
      retiredHandles: [{ handle: "ada_old", retiredAt: iso(T0 - DAY_MS) }],
      // 2d (11.2): last in the profile.
      sharePreviews: true,
    },
    posts: h.lists.posts.map((post) => ({
      id: post.id,
      body: post.body,
      createdAt: post.createdAt.toISOString(),
      replyToId: post.replyToId,
      quoteOfId: post.quoteOfId,
      state: post.state,
      deletedAt: post.deletedAt ? post.deletedAt.toISOString() : null,
      media: post.media.map((image) => ({ id: image.id, file: `media/${image.id}.webp`, altText: image.altText, width: image.width, height: image.height })),
      // 3b (11.2): after the images.
      imported: post.imported === null ? null : { source: post.imported.source, originalCreatedAt: post.imported.originalCreatedAt.toISOString(), shortened: post.imported.shortened },
      // 2d (11.2): last in the post.
      mentions: post.mentions,
      countsHidden: post.countsHidden,
    })),
    likes: h.lists.likes.map(ref),
    reposts: h.lists.reposts.map(ref),
    bookmarks: h.lists.bookmarks.map(ref),
    following: h.lists.following.map(other),
    blocks: h.lists.blocks.map(other),
    mutes: h.lists.mutes.map(other),
    sessions: [
      { id: h.otherSession, createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), current: false },
      { id: h.currentSession, createdAt: iso(T0 - DAY_MS), lastUsedAt: iso(T0), current: true },
    ],
    devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: iso(T0 - 3 * DAY_MS), lastSeenAt: iso(T0) }],
    events: [
      { type: "signin_success", at: iso(T0 - DAY_MS) },
      { type: "signup", at: iso(T0 - 3 * DAY_MS) },
    ],
    missingMedia,
    // With every entry's members in the format's order, whatever order the moderation module handed them over in.
    moderation: expectedModeration(h),
    // 3b (11.2): last, the account's imports, each member in the format's order.
    imports: h.imports.map((entry) => ({
      id: entry.id,
      source: entry.source,
      status: entry.status,
      createdAt: entry.createdAt.toISOString(),
      endedAt: entry.endedAt ? entry.endedAt.toISOString() : null,
      statedAt: entry.statedAt ? entry.statedAt.toISOString() : null,
      choice:
        entry.choice === null
          ? null
          : { from: entry.choice.from, to: entry.choice.to, replies: entry.choice.replies, warnings: entry.choice.warnings, protected: entry.choice.protected, images: entry.choice.images, long: entry.choice.long },
      counts: entry.counts,
    })),
    // 2d (11.2): last, the account's Activity, its rules and every received entry in the format's order.
    activity: {
      seenAt: "2026-09-21T09:30:00.123456Z",
      settings: { replies: "older", mentions: "following", quotes: "off", follows: false },
      received: h.lists.received.map((entry) => ({ kind: entry.kind, at: entry.at, postId: entry.postId, actorHandle: entry.actorHandle, shown: entry.shown })),
    },
  };
}

/** The moderation member as export.json holds it for the harness's account: the format's members, in the format's order. */
function expectedModeration(h: Harness) {
  return {
    decisions: [
      {
        id: h.removalId,
        decidedOn: "2026-09-12",
        postId: h.postId,
        kind: "final",
        outcome: "restricted",
        ground: "incompatible",
        ruleId: "R3",
        rulesVersion: 2,
        measures: [
          { kind: "remove", mediaId: null, noEffect: null },
          { kind: "remove_media", mediaId: h.imageA, noEffect: "already" },
        ],
        reversals: [],
        facts: "The post calls for a named group to be excluded.",
        reason: "That is an attack on people for what they are.",
        legalReference: null,
        appeal: { state: "answered", result: "kept" },
        automatedDetection: false,
        automatedDecision: "not_automated",
        signal: null,
        objection: null,
      },
      { id: h.correctionId, decidedOn: "2026-09-10", postId: null, kind: "correction", outcome: "reversed", ground: null, ruleId: null, rulesVersion: 2, measures: [], reversals: [{ kind: "restore_bio", mediaId: null }], facts: null, reason: null, legalReference: null, appeal: null, automatedDetection: false, automatedDecision: "not_automated", signal: null, objection: null },
      // 3d review L14 (people12): an order's notice keeps 3f's members, after the appeal, in the format's order.
      {
        id: h.orderedId,
        decidedOn: "2026-09-13",
        postId: null,
        kind: "order",
        outcome: "restricted",
        ground: "illegal",
        ruleId: null,
        rulesVersion: 2,
        measures: [],
        reversals: [],
        facts: null,
        reason: null,
        legalReference: null,
        appeal: null,
        order: {
          kind: "tco_removal",
          memberState: "DE",
          authority: "Example Police",
          reference: "AZ 1/26",
          verified: true,
          orderedOn: "2026-09-13",
          orderedFrom: "issued",
          crossBorder: false,
          homeState: null,
          withholdAuthor: false,
          disabledAt: "2026-09-13T09:30:00.000Z",
          held: false,
          informedAt: "2026-09-13T10:00:00.000Z",
          holdEndReason: null,
          preserveUntil: null,
          preserveFirstUntil: null,
          preserveExtended: false,
          preserveEndedOn: "2026-09-14",
          orderGround: null,
        },
        orderTexts: { reasons: "The post incites violence.", redress: "Court of Example", scope: null, textsAt: "2026-09-13T10:00:00.000Z", reasonsAt: "2026-09-13T10:00:00.000Z" },
        erasedOn: "2026-09-14",
        automatedDetection: false,
        automatedDecision: "not_automated",
        signal: null,
        objection: null,
      },
    ],
    reports: [
      {
        ref: "N-ABCDEFGH23",
        receivedAt: iso(T0 - DAY_MS),
        ground: "illegal",
        ruleId: null,
        category: "STATEMENT_CATEGORY_SCAMS_AND_FRAUD",
        explanation: "It offers a fake giveaway.",
        items: [
          { position: 1, link: `http://localhost:8081/post/${h.reportedPost}`, reexamines: false, outcome: "no_violation", outcomeText: "no action: korbat found no breach of its rules and nothing illegal.", reexaminationOpen: true },
          { position: 2, link: "http://localhost:8081/u/bob", reexamines: false, outcome: null, outcomeText: null, reexaminationOpen: null },
        ],
      },
    ],
    // 3e (W.8): the strikes the account was given, after its reports.
    strikes: [],
    // Then its standing measures, its replies and its report counts.
    standing: [
      {
        decisionId: h.removalId,
        kind: "suspend",
        basis: "threat",
        days: 7,
        announced: false,
        decidedAt: iso(T0 - 3 * DAY_MS),
        earliestStart: iso(T0 - 3 * DAY_MS),
        startsAt: iso(T0 - 3 * DAY_MS),
        endsAt: iso(T0 - DAY_MS),
        liftedAt: iso(T0 - DAY_MS),
        liftedBy: h.correctionId,
        replaced: false,
        basisEndedAt: null,
        basisEndedBy: null,
      },
    ],
    replies: [{ decisionId: h.removalId, filedAt: iso(T0 - 2 * DAY_MS), onTime: false, text: "I did not write that post.", erasedAt: null, answeredAt: iso(T0 - DAY_MS), answeredBy: h.correctionId }],
    reporting: {
      frameDays: 90,
      days: [{ day: "2026-09-11", reports: 2 }],
      marks: [{ ref: "N-ABCDEFGH24", position: 1, sentOn: "2026-09-11", markedAt: iso(T0 - DAY_MS), withdrawnAt: null, counts: true }],
      markedReports: 1,
    },
    // 3d (W.10): the refused upload and the release, last, each in the format's order.
    uploads: [
      {
        id: h.removalId,
        refusedAt: iso(T0 - 3 * DAY_MS),
        source: "test",
        matchKind: "exact",
        listedAs: "csam",
        objection: { text: "It is my own photo.", objectedAt: iso(T0 - 2 * DAY_MS) },
        mayObject: false,
        endedAt: iso(T0 - 2 * DAY_MS),
        endAs: "report",
        endReason: null,
        released: iso(T0 - DAY_MS),
        reportKept: true,
      },
    ],
    releases: [{ id: h.correctionId, basis: "leave", releasedAt: iso(T0 - DAY_MS), upload: true }],
  };
}

/** More rows in every list than a few pages of two hold: text that JSON escapes, a line break inside a body, characters outside ASCII. */
function addManyRows(h: Harness): void {
  const quote = String.fromCharCode(34);
  const newline = String.fromCharCode(10);
  const accented = `caf${String.fromCharCode(0xe9)} ${String.fromCodePoint(0x1f600)}`;
  for (let i = 0; i < 5; i++) {
    h.lists.posts.push({
      id: randomUUID(),
      body: `post ${i}: ${quote}quoted${quote}${newline}second line, ${accented}`,
      createdAt: new Date(T0 - DAY_MS + i),
      replyToId: i % 2 === 0 ? h.postId : null,
      quoteOfId: i === 3 ? h.postId : null,
      state: i === 4 ? "withheld" : "visible",
      deletedAt: null,
      media: i === 1 ? [{ id: randomUUID(), altText: `alt ${accented}`, width: 10, height: 20 }] : [],
      imported: null,
      mentions: i === 2 ? ["bob"] : [],
      countsHidden: i === 3,
    });
  }
  for (let i = 0; i < 5; i++) h.lists.received.push({ kind: i % 2 === 0 ? "follow" : "quote", at: `2026-09-19T0${i}:00:00.000000Z`, postId: i % 2 === 0 || i === 3 ? null : randomUUID(), actorHandle: `actor_${i}`, shown: i === 3 ? "post_not_visible" : true });
  for (let i = 0; i < 6; i++) h.lists.likes.push({ postId: randomUUID(), at: new Date(T0 - 900 + i) });
  for (let i = 0; i < 3; i++) h.lists.reposts.push({ postId: randomUUID(), at: new Date(T0 - 800 + i) });
  for (let i = 0; i < 4; i++) h.lists.bookmarks.push({ postId: randomUUID(), at: new Date(T0 - 700 + i) });
  for (let i = 0; i < 5; i++) h.lists.following.push({ handle: `friend_${i}`, since: new Date(T0 - 600 + i) });
  for (let i = 0; i < 2; i++) h.lists.blocks.push({ handle: `blocked_${i}`, since: new Date(T0 - 500 + i) });
  for (let i = 0; i < 3; i++) h.lists.mutes.push({ handle: `muted_${i}`, since: new Date(T0 - 400 + i) });
}

/** How many reads a list of `rows` takes in pages of `size`: full pages, then the short (maybe empty) one that says it is over. */
const readsFor = (rows: number, size: number) => Math.floor(rows / size) + 1;

describe("building the export", () => {
  test("the JSON follows the contract, marks the current session, lists the passkeys with nothing of their keys, and keeps a deleted post with its empty body and deletion time", async () => {
    const h = harness();
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const json = ExportFormat.parse(JSON.parse((await collect(exportJson(plan))).join("")));
    expect(json.format).toBe("korbat-export-1");
    expect(json.exportedAt).toBe(iso(T0));
    expect(json.account).toEqual({
      id: h.userId,
      email: "ada@korbat.local",
      createdAt: iso(T0 - 3 * DAY_MS),
      role: "user",
      mfaEnabled: true,
      hasPassword: false,
      verified: true,
      termsVersion: "draft-test",
      termsAcceptedAt: iso(T0 - 3 * DAY_MS),
      // Inside the account, in the auth module's order (newest first), each as the five facts with the times as ISO text.
      passkeys: [
        { name: "Security key", createdAt: iso(T0 - DAY_MS), lastUsedAt: null, synced: false, createdOn: null },
        { name: "Laptop", createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), synced: true, createdOn: "Chrome on Windows" },
      ],
    });
    expect(json.sessions).toEqual([
      { id: h.otherSession, createdAt: iso(T0 - 2 * DAY_MS), lastUsedAt: iso(T0 - DAY_MS), current: false },
      { id: h.currentSession, createdAt: iso(T0 - DAY_MS), lastUsedAt: iso(T0), current: true },
    ]);
    expect(json.devices).toEqual([{ label: "Chrome on Windows", platform: "web", firstSeenAt: iso(T0 - 3 * DAY_MS), lastSeenAt: iso(T0) }]);
    expect(json.events).toEqual([
      { type: "signin_success", at: iso(T0 - DAY_MS) },
      { type: "signup", at: iso(T0 - 3 * DAY_MS) },
    ]);
    // With the author's Explore switch as the profile holds it (off here); the byte-for-byte tests below place it after the handle history.
    expect(json.profile).toEqual({ handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: iso(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"], showInExplore: false, retiredHandles: [{ handle: "ada_old", retiredAt: iso(T0 - DAY_MS) }], sharePreviews: true });
    expect(json.posts).toHaveLength(2);
    expect(json.posts[0]).toEqual({
      id: h.postId,
      body: "two photos",
      createdAt: iso(T0 - 2 * DAY_MS),
      replyToId: null,
      quoteOfId: null,
      state: "visible",
      deletedAt: null,
      media: [
        { id: h.imageA, file: `media/${h.imageA}.webp`, altText: "a harbour at dawn", width: 1600, height: 1200 },
        { id: h.imageB, file: `media/${h.imageB}.webp`, altText: "a lighthouse", width: 900, height: 1600 },
      ],
      // 3b (11.2): a native post carries no import.
      imported: null,
      // 2d (11.2): its mentions as written, in order, and its hidden counts.
      mentions: ["bob", "old_name"],
      countsHidden: true,
    });
    expect(json.posts[1]).toEqual({ id: h.deletedId, body: "", createdAt: iso(T0 - DAY_MS), replyToId: h.postId, quoteOfId: null, state: "deleted_by_author", deletedAt: iso(T0 - 1_000), media: [], imported: null, mentions: [], countsHidden: false });
    expect(json.likes).toEqual([{ postId: h.likedId, at: iso(T0 - DAY_MS) }]);
    expect(json.reposts).toEqual([]);
    expect(json.bookmarks).toEqual([{ postId: h.bookmarkedId, at: iso(T0 - 500) }]);
    expect(json.following).toEqual([{ handle: "bob", since: iso(T0 - 2 * DAY_MS) }]);
    expect(json.blocks).toEqual([{ handle: "eve", since: iso(T0 - DAY_MS) }]);
    expect(json.mutes).toEqual([{ handle: "carol", since: iso(T0 - 200) }]);
    expect(json.missingMedia).toEqual([]);
    expect(plan.images).toEqual([]);
    // Building the plan records nothing: the event belongs after the last chunk of the stream.
    expect(h.events).toEqual([]);
  });

  test("the images to write are the media module's, and the entry name is media/<id>.webp", async () => {
    const h = harness();
    h.images.push({ id: randomUUID(), open: openerOf(path.join(root, "a")) }, { id: randomUUID(), open: openerOf(path.join(root, "b")) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    expect(plan.images).toEqual(h.images);
    expect(mediaEntry(h.images[0]!.id)).toBe(`media/${h.images[0]!.id}.webp`);
  });

  test("export.json is read list by list in pages and written piece by piece, byte for byte as JSON.stringify(document, null, 2) writes it", async () => {
    const h = harness();
    addManyRows(h);
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now(), 2);
    // Only the account and the profile's own fields are read up front; the lists wait for the JSON to be written.
    expect(h.reads).toEqual([]);
    const text = (await collect(exportJson(plan))).join("");
    expect(text).toBe(JSON.stringify(expectedDocument(h), null, 2));
    expect(() => ExportFormat.parse(JSON.parse(text))).not.toThrow();
    // Every list was read in pages of two, one page after the other, in the document's order.
    // 2d: and Activity's received entries, last.
    const order: (keyof Lists)[] = ["posts", "likes", "reposts", "bookmarks", "following", "blocks", "mutes", "received"];
    expect(h.reads).toEqual(order.flatMap((name) => Array.from({ length: readsFor(h.lists[name].length, 2) }, () => name)));
    // The same account in one page per list is the same text.
    const whole = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    expect((await collect(exportJson(whole))).join("")).toBe(text);
  });

  test("empty lists and missing images are written as JSON.stringify writes them", async () => {
    const h = harness();
    for (const name of ["posts", "likes", "bookmarks", "following", "blocks", "mutes"] as const) h.lists[name].length = 0;
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now(), 3);
    plan.missingMedia.push(h.imageA, h.imageB);
    expect((await collect(exportJson(plan))).join("")).toBe(JSON.stringify(expectedDocument(h, [h.imageA, h.imageB]), null, 2));
  });

  test("the moderation member comes last but 3b's imports: read once, before the first byte, for the account that asks, and written with the format's members in the format's order and nothing else", async () => {
    const h = harness();
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    // Read with the account's own facts, before anything is written.
    expect(h.asked).toEqual([h.userId]);
    const text = (await collect(exportJson(plan))).join("");
    const raw = JSON.parse(text) as Record<string, unknown>;
    // 3b Task 6 (11.2): the account's imports follow it, and 2d's Activity follows them, the document's last member since.
    expect(Object.keys(raw).slice(-3)).toEqual(["moderation", "imports", "activity"]);
    expect(raw.moderation).toStrictEqual(expectedModeration(h));
    // The contract reads it whole: nothing of it lies outside the format.
    expect(ExportFormat.parse(raw).moderation).toStrictEqual(raw.moderation);
    // Member for member in the format's order, though the module handed every object over in another one.
    const NL = String.fromCharCode(10);
    const activity = JSON.stringify(expectedDocument(h).activity, null, 2).replaceAll(NL, `${NL}  `);
    expect(text.endsWith(`,${NL}  "moderation": ${JSON.stringify(expectedModeration(h), null, 2).replaceAll(NL, `${NL}  `)},${NL}  "imports": [],${NL}  "activity": ${activity}${NL}}`)).toBe(true);
    // What the module's objects carry beyond the format is not written.
    expect(text).not.toContain("decidedBy");
    expect(text).not.toContain("a staff member the export must never name");
    expect(h.asked).toEqual([h.userId]);
  });

  test("an account module built without the moderation module still writes the member, with empty lists and counts over the standing rules' frame", async () => {
    const h = harness();
    const deps: AccountDeps = { ...h.deps, moderation: undefined };
    const text = (await collect(exportJson(await buildExport(deps, h.userId, h.currentSession, h.now())))).join("");
    expect(text).toBe(JSON.stringify({ ...expectedDocument(h), moderation: { decisions: [], reports: [], strikes: [], standing: [], replies: [], reporting: { frameDays: STANDING_RULES.reportFrameDays, days: [], marks: [], markedReports: 0 }, uploads: [], releases: [] } }, null, 2));
    expect(() => ExportFormat.parse(JSON.parse(text))).not.toThrow();
    expect(h.asked).toEqual([]);
  });

  test("3b (11.2): an imported post carries its source, the archive's date and its mark last; the document ends with the account's imports, member by member", async () => {
    const h = harness();
    const original = new Date(Date.UTC(2019, 2, 3, 12, 0, 0));
    h.lists.posts.push({ id: randomUUID(), body: "from the archive", createdAt: new Date(T0 - 500), replyToId: null, quoteOfId: null, state: "visible", deletedAt: null, media: [], imported: { source: "mastodon", originalCreatedAt: original, shortened: true }, mentions: [], countsHidden: false });
    // Handed over with the choice's members in another order: the export writes the format's.
    h.imports.push(
      {
        id: randomUUID(),
        source: "mastodon",
        status: "done",
        createdAt: new Date(T0 - 2 * DAY_MS),
        endedAt: new Date(T0 - DAY_MS),
        statedAt: new Date(T0 - 2 * DAY_MS + 1_000),
        choice: { long: "shorten", images: false, protected: false, warnings: false, replies: true, to: "2019-12", from: null },
        counts: { postsPublished: 1, postsRemoved: 0, imagesKept: 0, imagesLeftOut: 0 },
      },
      { id: randomUUID(), source: "x", status: "cancelled", createdAt: new Date(T0 - 3 * DAY_MS), endedAt: new Date(T0 - 3 * DAY_MS), statedAt: null, choice: null, counts: { postsPublished: 0, postsRemoved: 0, imagesKept: 0, imagesLeftOut: 0 } },
    );
    const text = (await collect(exportJson(await buildExport(h.deps, h.userId, h.currentSession, h.now())))).join("");
    const document = JSON.parse(text) as { posts: { imported: unknown }[]; imports: { choice: Record<string, unknown> | null }[] };
    expect(ExportFormat.parse(document)).toEqual(document);
    // 2d (11.2) moved the pin: Activity follows the imports.
    expect(Object.keys(document).slice(-2)).toEqual(["imports", "activity"]);
    expect(document.posts.at(-1)!.imported).toEqual({ source: "mastodon", originalCreatedAt: original.toISOString(), shortened: true });
    expect(document.posts[0]!.imported).toBeNull();
    expect(Object.keys(document.imports[0]!.choice!)).toEqual(["from", "to", "replies", "warnings", "protected", "images", "long"]);
    expect(document.imports[1]!.choice).toBeNull();
    expect(text).toBe(JSON.stringify(expectedDocument(h), null, 2));
  });

  test("2d (11.2): the activity member comes last, read with the account's facts and its received entries in pages, written member by member in the format's order; without the activity module, the defaults and no entry", async () => {
    const h = harness();
    addManyRows(h);
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now(), 2);
    const text = (await collect(exportJson(plan))).join("");
    const raw = JSON.parse(text) as { activity: { settings: Record<string, unknown>; received: Record<string, unknown>[] } };
    expect(Object.keys(raw).at(-1)).toBe("activity");
    expect(Object.keys(raw.activity)).toEqual(["seenAt", "settings", "received"]);
    expect(Object.keys(raw.activity.settings)).toEqual(["replies", "mentions", "quotes", "follows"]);
    expect(raw.activity.received.map((entry) => Object.keys(entry))).toEqual(h.lists.received.map(() => ["kind", "at", "postId", "actorHandle", "shown"]));
    expect(ExportFormat.parse(raw).activity.received).toHaveLength(h.lists.received.length);
    // Read in pages of two, after every other list, one page after the other.
    expect(h.reads.filter((name) => name === "received")).toHaveLength(readsFor(h.lists.received.length, 2));
    expect(h.reads.at(-1)).toBe("received");
    const without: AccountDeps = { ...h.deps, activity: undefined };
    const bare = JSON.parse((await collect(exportJson(await buildExport(without, h.userId, h.currentSession, h.now())))).join("")) as { activity: unknown };
    expect(bare.activity).toEqual({ seenAt: null, settings: { ...ACTIVITY_DEFAULTS }, received: [] });
    expect(() => ExportFormat.parse(bare)).not.toThrow();
  });

  test("a large account's export.json comes in several pieces of at most 64 KiB of UTF-8", async () => {
    const h = harness();
    const accented = String.fromCharCode(0xe9).repeat(200);
    for (let i = 0; i < 3_000; i++) h.lists.likes.push({ postId: randomUUID(), at: new Date(T0 - 100_000 + i) });
    for (let i = 0; i < 1_000; i++) h.lists.posts.push({ id: randomUUID(), body: accented, createdAt: new Date(T0 - 50_000 + i), replyToId: null, quoteOfId: null, state: "visible", deletedAt: null, media: [], imported: null, mentions: [], countsHidden: false });
    const pieces = await collect(exportJson(await buildExport(h.deps, h.userId, h.currentSession, h.now())));
    expect(pieces.length).toBeGreaterThan(5);
    for (const piece of pieces) expect(Buffer.byteLength(piece, "utf8")).toBeLessThanOrEqual(KIB64);
    expect(pieces.join("")).toBe(JSON.stringify(expectedDocument(h), null, 2));
  });

  test("the file name carries the handle and the day of the export", () => {
    expect(exportFilename("ada_l", new Date("2026-09-24T23:59:59.000Z"))).toBe("korbat-export-ada_l-2026-09-24.zip");
  });

  test("one export a day: the second is rate_limited with a Retry-After, the next day is allowed again, and a store that fails closes the door", async () => {
    const h = harness();
    await enforceExportLimit(h.deps, h.userId);
    const refused = await enforceExportLimit(h.deps, h.userId).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(AccountError);
    expect((refused as AccountError).code).toBe("rate_limited");
    expect((refused as AccountError).status).toBe(429);
    expect((refused as AccountError).retryAfterSeconds).toBeGreaterThan(0);
    expect((refused as AccountError).retryAfterSeconds).toBeLessThanOrEqual(EXPORT_WINDOW_MS / 1000);
    // Another account is not affected.
    await enforceExportLimit(h.deps, randomUUID());
    h.advance(EXPORT_WINDOW_MS + 1);
    await enforceExportLimit(h.deps, h.userId);

    const failing: AccountDeps = {
      ...h.deps,
      limits: {
        hit: async () => {
          throw new Error("store down");
        },
        release: async () => undefined,
      },
    };
    const down = await enforceExportLimit(failing, h.userId).catch((err: unknown) => err);
    expect(down).toBeInstanceOf(AccountError);
    expect((down as AccountError).code).toBe("service_unavailable");
    expect((down as AccountError).status).toBe(503);
    expect((down as AccountError).retryAfterSeconds).toBe(30);
  });
});

describe("writing the archive", () => {
  test("the archive holds export.json and every image byte for byte, in chunks that are each awaited", async () => {
    const bytesA = randomBytes(200_000);
    const bytesB = Buffer.from("small-webp");
    const h = harness();
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) }, { id: h.imageB, open: openerOf(fileOf(bytesB)) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    expect(sink.overlapped).toBe(false);
    // Two hundred kilobytes do not fit in one read: the image went through several awaited writes.
    expect(sink.count).toBeGreaterThan(3);

    const files = unzipSync(sink.bytes());
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${h.imageA}.webp`, `media/${h.imageB}.webp`].sort());
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageB}.webp`]!), bytesB)).toBe(0);
    expect(strFromU8(files["export.json"]!)).toBe(JSON.stringify(expectedDocument(h), null, 2));
    expect(centralDirectory(sink.bytes()).map((entry) => [entry.name, entry.method])).toEqual([
      [`media/${h.imageA}.webp`, 0],
      [`media/${h.imageB}.webp`, 0],
      ["export.json", 8],
    ]);
  });

  test("an image whose file is gone is listed under missingMedia, and the archive still closes with the others", async () => {
    const bytesA = Buffer.from("still-there");
    const h = harness();
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) }, { id: h.imageB, open: openerOf(path.join(root, randomUUID(), "large.webp")) });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${h.imageA}.webp`].sort());
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    const json = ExportFormat.parse(JSON.parse(strFromU8(files["export.json"]!)));
    expect(json.missingMedia).toEqual([h.imageB]);
    // The post still names the entry the image would have had; missingMedia says why it is not there.
    expect(json.posts[0]!.media[1]!.file).toBe(`media/${h.imageB}.webp`);
    expect(plan.missingMedia).toEqual([h.imageB]);
  });

  /** A store with one image whose large variant holds `bytes`, read through the media module's checked open. */
  async function storeWith(id: string, bytes: Uint8Array) {
    const base = path.join(root, randomUUID());
    const files = createMediaFiles({ uploadsDir: path.join(base, "uploads"), storeDir: path.join(base, "store"), log: silent });
    await files.prepare();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    writeFileSync(files.store.image(id, "large"), bytes);
    return files;
  }

  test("an image larger than a variant may be is refused by the checked open and listed under missingMedia like a missing one", async () => {
    const h = harness();
    const files = await storeWith(h.imageA, Buffer.from("planted"));
    // A sparse file of any size could be planted in the store; the checked open refuses anything over the variant limit.
    truncateSync(files.store.image(h.imageA, "large"), MAX_VARIANT_BYTES + 1);
    const kept = await storeWith(h.imageB, Buffer.from("fine"));
    h.images.push({ id: h.imageA, open: () => files.openImage(h.imageA, "large") }, { id: h.imageB, open: () => kept.openImage(h.imageB, "large") });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    const archive = sink.bytes();
    expect(archive.length).toBeLessThan(MAX_VARIANT_BYTES);
    const unpacked = unzipSync(archive);
    expect(Object.keys(unpacked).sort()).toEqual(["export.json", `media/${h.imageB}.webp`].sort());
    expect(ExportFormat.parse(JSON.parse(strFromU8(unpacked["export.json"]!))).missingMedia).toEqual([h.imageA]);
  });

  test("a file that grows after the checked open is read only to the size the open measured", async () => {
    const h = harness();
    const original = randomBytes(150_000);
    const files = await storeWith(h.imageA, original);
    h.images.push({
      id: h.imageA,
      open: async () => {
        const stored = await files.openImage(h.imageA, "large");
        // Whatever lands in the file after the check is not the checked file's.
        appendFileSync(files.store.image(h.imageA, "large"), randomBytes(100_000));
        return stored;
      },
    });
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), await buildExport(h.deps, h.userId, h.currentSession, h.now()));
    const unpacked = unzipSync(sink.bytes());
    expect(Buffer.compare(Buffer.from(unpacked[`media/${h.imageA}.webp`]!), original)).toBe(0);
  });
});

describe("the zip writer", () => {
  test("entries come out in the order they were added: JSON pieces deflated as one text, files stored as they are", async () => {
    const stored = randomBytes(70_000);
    const first = JSON.stringify({ kind: "first", filler: "x".repeat(2_000) }, null, 2);
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    await writer.addJsonPieces("first.json", piecesOf(first.slice(0, 700), first.slice(700)));
    expect(await writer.addFile("files/stored.bin", openerOf(fileOf(stored)))).toBe(true);
    await writer.addJsonPieces("last.json", piecesOf('{ "kind": "last" }'));
    await writer.end();

    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toEqual(["first.json", "files/stored.bin", "last.json"]);
    expect(strFromU8(files["first.json"]!)).toBe(first);
    expect(Buffer.compare(Buffer.from(files["files/stored.bin"]!), stored)).toBe(0);
    expect(strFromU8(files["last.json"]!)).toBe('{ "kind": "last" }');
    const directory = centralDirectory(sink.bytes());
    expect(directory.map((entry) => [entry.name, entry.method])).toEqual([
      ["first.json", 8],
      ["files/stored.bin", 0],
      ["last.json", 8],
    ]);
    // A plain archive has no ZIP64 field or record, and every entry streams its sizes after its data.
    expect(directory.map((entry) => entry.zip64)).toEqual([null, null, null]);
    expect(directory.every((entry) => entry.versionNeeded === 45 && (entry.flags & 0x0008) !== 0)).toBe(true);
    expect(endRecords(sink.bytes()).end64).toBeNull();
    expect(sink.overlapped).toBe(false);
  });

  test("a file the open refuses adds nothing and answers false; a zero-byte file is an entry without data", async () => {
    const dir = path.join(root, randomUUID());
    mkdirSync(dir, { recursive: true });
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    expect(await writer.addFile("missing.bin", openerOf(path.join(root, randomUUID(), "missing.webp")))).toBe(false);
    expect(await writer.addFile("dir.bin", openerOf(dir))).toBe(false);
    const empty = fakeFile(0);
    expect(await writer.addFile("empty.bin", empty.open)).toBe(true);
    expect(empty.state).toEqual({ chunks: 0, stopped: false, closed: true });
    await writer.addJsonPieces("only.json", piecesOf('{ "ok": true }'));
    await writer.end();
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toEqual(["empty.bin", "only.json"]);
    expect(files["empty.bin"]!.length).toBe(0);
    expect(centralDirectory(sink.bytes()).map((entry) => entry.name)).toEqual(["empty.bin", "only.json"]);
  });

  test("an empty archive is still a valid archive", async () => {
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    await writer.end();
    expect(unzipSync(sink.bytes())).toEqual({});
  });

  test("the JSON is fed to the deflate at most 64 KiB at a time, and the event loop turns between two feeds", async () => {
    const push = vi.spyOn(Deflate.prototype, "push");
    const chunks: Uint8Array[] = [];
    const writer = createZipWriter(async (chunk) => {
      chunks.push(Uint8Array.from(chunk));
    });
    let turns = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      turns += 1;
      setImmediate(tick);
    };
    setImmediate(tick);
    // One piece of 300 KiB and ten small ones.
    const big = "y".repeat(300 * 1024);
    let fed: number[];
    try {
      await writer.addJsonPieces("big.json", piecesOf(big, ...Array.from({ length: 10 }, (_, i) => `,${i}`)));
      await writer.end();
      // Read before the spy is restored, which forgets its calls.
      fed = push.mock.calls.map(([chunk]) => chunk.length);
    } finally {
      running = false;
      push.mockRestore();
    }
    expect(Math.max(...fed)).toBeLessThanOrEqual(KIB64);
    expect(fed.filter((length) => length > 0)).toHaveLength(5 + 10);
    expect(turns).toBeGreaterThanOrEqual(10);
    expect(strFromU8(unzipSync(Buffer.concat(chunks))["big.json"]!)).toBe(big + Array.from({ length: 10 }, (_, i) => `,${i}`).join(""));
  });

  test("forced ZIP64 on a small archive: it opens and gives back its bytes, and its records say what a ZIP64 reader needs", async () => {
    const stored = randomBytes(5_000);
    const sink = memorySink();
    const writer = createZipWriter(sink.write, { zip64: "always" });
    expect(await writer.addFile("a.bin", openerOf(fileOf(stored)))).toBe(true);
    await writer.addJsonPieces("b.json", piecesOf('{ "b": 1 }'));
    await writer.end();
    const archive = sink.bytes();

    const files = unzipSync(archive);
    expect(Object.keys(files)).toEqual(["a.bin", "b.json"]);
    expect(Buffer.compare(Buffer.from(files["a.bin"]!), stored)).toBe(0);
    expect(strFromU8(files["b.json"]!)).toBe('{ "b": 1 }');

    // Every 32-bit field reads 0xFFFFFFFF and the extra field holds the uncompressed size, the compressed size and the offset, in that order.
    const [a, b] = centralDirectory(archive);
    expect(a).toMatchObject({ name: "a.bin", compressed: 0xffffffff, size: 0xffffffff, offset: 0xffffffff, zip64: [5_000, 5_000, 0] });
    expect(b!.zip64![2]).toBe(30 + "a.bin".length + 5_000 + 24);
    expect(b!.zip64![0]).toBe(10);
    // The data descriptor after a.bin's bytes carries 8-byte sizes.
    const descriptor = 30 + "a.bin".length + 5_000;
    expect(archive.readUInt32LE(descriptor)).toBe(0x08074b50);
    expect([u64(archive, descriptor + 8), u64(archive, descriptor + 16)]).toEqual([5_000, 5_000]);

    const { end, locator, end64 } = endRecords(archive);
    const directoryOffset = a!.at;
    expect(end64).toEqual({
      at: archive.length - 22 - 20 - 56,
      recordSize: 44,
      versionMadeBy: 45,
      versionNeeded: 45,
      disk: 0,
      directoryDisk: 0,
      entriesHere: 2,
      entries: 2,
      size: end64!.at - directoryOffset,
      offset: directoryOffset,
    });
    expect(locator).toEqual({ disk: 0, offset: end64!.at, disks: 1 });
    expect(end).toEqual({ entriesHere: 0xffff, entries: 0xffff, size: 0xffffffff, offset: 0xffffffff, comment: 0 });
  });

  test("the writer turns to ZIP64 by itself once an offset passes 4 GiB", async () => {
    const start = TWO_32 - 100;
    const sink = memorySink();
    const writer = createZipWriter(sink.write, { startOffset: start });
    await writer.addFile("a.bin", openerOf(fileOf(Buffer.alloc(50, 1))));
    await writer.addFile("b.bin", openerOf(fileOf(Buffer.alloc(40, 2))));
    await writer.end();
    const archive = sink.bytes();

    const bOffset = start + 30 + 5 + 50 + 16;
    expect(bOffset).toBeGreaterThan(0xffffffff);
    const [a, b] = centralDirectory(archive, start);
    // a.bin starts below 4 GiB and needs nothing; b.bin's offset goes into the extra field alone.
    expect(a).toMatchObject({ name: "a.bin", compressed: 50, size: 50, offset: start, zip64: null });
    expect(b).toMatchObject({ name: "b.bin", compressed: 40, size: 40, offset: 0xffffffff, zip64: [bOffset] });
    // Neither entry reached 4 GiB, so both descriptors keep 4-byte sizes.
    expect(archive.readUInt32LE(30 + 5 + 50)).toBe(0x08074b50);
    expect(archive.readUInt32LE(30 + 5 + 50 + 16)).toBe(0x04034b50);

    const { end, locator, end64 } = endRecords(archive, start);
    expect(end64).toMatchObject({ entriesHere: 2, entries: 2, size: end64!.at - a!.at, offset: a!.at });
    expect(a!.at).toBeGreaterThan(0xffffffff);
    expect(locator).toEqual({ disk: 0, offset: end64!.at, disks: 1 });
    // Only the directory's offset overflows the classic record.
    expect(end).toEqual({ entriesHere: 2, entries: 2, size: end64!.at - a!.at, offset: 0xffffffff, comment: 0 });
  });

  test("an entry of more than 4 GiB is a ZIP64 entry by itself, without the archive being kept in memory", { timeout: 120_000 }, async () => {
    const huge = fakeFile(TWO_32 + 1);
    // Counts every byte and keeps only what is not the file's own data, with where it starts.
    const kept: { at: number; bytes: Uint8Array }[] = [];
    let written = 0;
    const writer = createZipWriter(async (chunk) => {
      if (chunk.buffer !== huge.chunk.buffer) kept.push({ at: written, bytes: Uint8Array.from(chunk) });
      written += chunk.length;
    });
    expect(await writer.addFile("huge.bin", huge.open)).toBe(true);
    await writer.addJsonPieces("after.json", piecesOf('{ "after": true }'));
    await writer.end();
    expect(huge.state).toEqual({ chunks: TWO_32 / KIB64 + 1, stopped: true, closed: true });

    // Everything after the file's data is kept together: its descriptor, the next entry, the directory and the end records.
    const dataEnd = 30 + "huge.bin".length + TWO_32 + 1;
    const tail = Buffer.concat(kept.filter((piece) => piece.at >= dataEnd).map((piece) => piece.bytes));
    expect(dataEnd + tail.length).toBe(written);
    expect(tail.readUInt32LE(0)).toBe(0x08074b50);
    expect([u64(tail, 8), u64(tail, 16)]).toEqual([TWO_32 + 1, TWO_32 + 1]);
    const [hugeEntry, after] = centralDirectory(tail, dataEnd);
    expect(hugeEntry).toMatchObject({ name: "huge.bin", compressed: 0xffffffff, size: 0xffffffff, offset: 0, zip64: [TWO_32 + 1, TWO_32 + 1] });
    expect(after).toMatchObject({ name: "after.json", offset: 0xffffffff, zip64: [dataEnd + 24] });
    const { end, end64 } = endRecords(tail, dataEnd);
    expect(end64).toMatchObject({ entries: 2, offset: hugeEntry!.at });
    expect(end).toMatchObject({ entries: 2, offset: 0xffffffff });
  });
});

describe("the export route", () => {
  /**
   * The account routes on their own, with the session and the logger a request would carry and an error
   * handler that renders AccountError as the app's does; everything else is a 500. The freshness and
   * session guards are passed through: http-account.test.ts covers them on the real app.
   */
  function app(h: Harness, log = silent) {
    const session: Session = {
      sessionId: randomBytes(32).toString("hex"),
      userId: h.userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: h.now(),
      // The route marks the current session by this, the id the list carries, and not by the token's hash above.
      handle: h.currentSession,
      factors: { email: h.now().getTime() },
      passkeyId: null,
    };
    const pass: MiddlewareHandler<AppEnv> = async (_c, next) => {
      await next();
    };
    const a = new Hono<AppEnv>();
    a.use(async (c, next) => {
      c.set("requestId", "test");
      c.set("log", log);
      c.set("session", session);
      c.set("authVia", "cookie");
      await next();
    });
    a.route("/api/account", accountRoutes(h.deps, pass, pass, pass));
    a.onError((err, c) => (err instanceof AccountError ? c.json({ error: { code: err.code } }, err.status) : c.json({ error: { code: "internal" } }, 500)));
    return a;
  }
  const exportOf = (a: Hono<AppEnv>) => a.request("/api/account/export", { method: "POST" });
  const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
  const exported = (h: Harness) => h.events.filter((event) => event.type === "export_created").length;

  test("a complete export streams a valid archive with its headers and records export_created", async () => {
    const h = harness();
    const bytesA = randomBytes(300_000);
    h.images.push({ id: h.imageA, open: openerOf(fileOf(bytesA)) });
    const res = await exportOf(app(h));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="korbat-export-ada-${iso(T0).slice(0, 10)}.zip"`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Buffer.compare(Buffer.from(files[`media/${h.imageA}.webp`]!), bytesA)).toBe(0);
    expect(strFromU8(files["export.json"]!)).toBe(JSON.stringify(expectedDocument(h), null, 2));
    // Recorded once every chunk was taken, before the body ended.
    expect(h.events).toEqual([{ userId: h.userId, type: "export_created", metadata: undefined }]);
  });

  test("a failure before the first byte answers an error and gives the day's export back", async () => {
    const h = harness();
    const a = app(h);
    // The build fails: a pool timeout while the account is read.
    h.failures.exportAccount = 1;
    const failed = await exportOf(a);
    expect(failed.status).toBe(500);
    expect(await errorCode(failed)).toBe("internal");
    // The first image cannot even be opened: still nothing sent.
    h.images.push({
      id: h.imageA,
      open: async () => {
        throw new Error("too many open files");
      },
    });
    const unopened = await exportOf(a);
    expect(unopened.status).toBe(500);
    expect(exported(h)).toBe(0);
    h.images.length = 0;
    const ok = await exportOf(a);
    expect(ok.status).toBe(200);
    expect(Object.keys(unzipSync(new Uint8Array(await ok.arrayBuffer())))).toEqual(["export.json"]);
    expect(exported(h)).toBe(1);
    expect(await errorCode(await exportOf(a))).toBe("rate_limited");
  });

  test("a moderation read that fails before the first byte answers an error and gives the day's export back; the next export carries the member", async () => {
    const h = harness();
    const a = app(h);
    h.failures.exportFor = 1;
    const failed = await exportOf(a);
    expect(failed.status).toBe(500);
    expect(await errorCode(failed)).toBe("internal");
    expect(exported(h)).toBe(0);
    const ok = await exportOf(a);
    expect(ok.status).toBe(200);
    const json = JSON.parse(strFromU8(unzipSync(new Uint8Array(await ok.arrayBuffer()))["export.json"]!)) as { moderation: unknown };
    expect(json.moderation).toStrictEqual(expectedModeration(h));
    expect(exported(h)).toBe(1);
    expect(h.asked).toEqual([h.userId, h.userId]);
  });

  test("a limit store that cannot give the export back is logged, and the build's own error is answered", async () => {
    const h = harness();
    const lines: string[] = [];
    const log = pino({ level: "warn" }, new Writable({ write: (chunk: Buffer, _encoding, done) => (lines.push(chunk.toString("utf8")), done()) }));
    const store = new MemoryStore(() => h.now().getTime());
    h.deps.limits = {
      hit: (key, windowMs) => store.hit(key, windowMs),
      release: async () => {
        throw new Error("the store went away");
      },
    };
    h.failures.exportAccount = 1;
    const res = await exportOf(app(h, log));
    expect(res.status).toBe(500);
    expect(await errorCode(res)).toBe("internal");
    expect(lines.map((line) => (JSON.parse(line) as { level: number; msg: string }).level)).toEqual([40]);
    expect(lines[0]).toMatch(/could not be given back/);
  });

  test("an image that fails in the middle of its reading fails the response body, and the day's export stays spent", async () => {
    const h = harness();
    const failing = fakeFile(1_000_000, { failAfter: 3 });
    h.images.push({ id: h.imageA, open: failing.open });
    const a = app(h);
    const res = await exportOf(a);
    // The status went out with the first bytes; what follows can only end the body with an error, never cleanly.
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
    expect(failing.state).toMatchObject({ chunks: 3, stopped: true, closed: true });
    expect(exported(h)).toBe(0);
    h.images.length = 0;
    expect(await errorCode(await exportOf(a))).toBe("rate_limited");
  });

  test("a client that goes away stops the file reads", async () => {
    const h = harness();
    // A hundred megabytes, read only as fast as the response is taken.
    const big = fakeFile(100 * 1024 * 1024);
    h.images.push({ id: h.imageA, open: big.open });
    const res = await exportOf(app(h));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(big.state).toMatchObject({ stopped: true, closed: true }));
    expect(big.state.chunks).toBeLessThan(10);
    expect(exported(h)).toBe(0);
  });
});
