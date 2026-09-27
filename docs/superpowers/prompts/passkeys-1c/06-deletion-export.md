# korbat passkeys (1c) — Task 6 of 9: Deletion and export cover passkeys: the take-down deletes the account's passkeys and clears its WebAuthn user handle inside its transaction (the purge repeats both), and the export lists the passkeys (name, dates, synced, the adding device) with no key material or ids, byte-identical to the streamed document

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-25 to 2026-09-27 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

This task makes deletion and the export cover passkeys: the take-down (and the purge that repeats it) deletes the account's passkeys and clears its WebAuthn user handle inside its transaction, with the integration proof that a deleted account's passkey stays refused after the take-down and after the purge; and the export lists the passkeys (name, dates, synced, the adding device) with no key material or ids, in its place in the streamed document, which stays byte-identical to JSON.stringify(document, null, 2).

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api,contracts): passkey sign-in and re-authentication: sign-in options without a session and verify (the challenge spent before the library runs, the user handle checked, a suspended passkey refused after its signature, the counter written in one conditional update and a regression suspending the passkey, recording it, mailing the owner and refusing; passkey_uv only for a user-verified assertion on a passkey registered with user verification; a new-device limit counted after the signature; the MFA ticket when the account has TOTP and the assertion lacked user verification, or the account is staff); re-authentication options and the passkey method on the re-authentication flow; ReauthRequest moves to the passkey contracts`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/06-deletion-export.md 1
```

Expected: 6 lines starting with `wrote`, one for each file below.

### Replace `apps/api/test/account/export.test.ts` (whole file)

```ts
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
import { ExportFormat } from "@korbat/contracts";
import { MAX_VARIANT_BYTES } from "@korbat/media-protocol";
import { AccountError, type AccountDeps } from "../../src/account/context";
import { EXPORT_WINDOW_MS, buildExport, enforceExportLimit, exportFilename, exportJson, mediaEntry, writeExport } from "../../src/account/flows/export";
import { accountRoutes } from "../../src/account/routes";
import { createZipWriter, type OpenFile } from "../../src/account/zip";
import type { AccountExport, AuthEventType, Session } from "../../src/auth";
import type { AppEnv } from "../../src/env";
import { createMediaFiles } from "../../src/media/files";
import { MemoryStore } from "../../src/middleware/rate-limit";
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
  const currentSession = randomBytes(32).toString("hex");
  const otherSession = randomBytes(32).toString("hex");
  const [postId, deletedId, likedId, bookmarkedId, imageA, imageB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const events: RecordedEvent[] = [];
  const reads: string[] = [];
  const failures = { exportAccount: 0 };
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
      },
      { id: deletedId, body: "", createdAt: new Date(T0 - DAY_MS), replyToId: postId, quoteOfId: null, state: "deleted_by_author", deletedAt: new Date(T0 - 1_000), media: [] },
    ],
    likes: [{ postId: likedId, at: new Date(T0 - DAY_MS) }],
    reposts: [],
    bookmarks: [{ postId: bookmarkedId, at: new Date(T0 - 500) }],
    following: [{ handle: "bob", since: new Date(T0 - 2 * DAY_MS) }],
    blocks: [{ handle: "eve", since: new Date(T0 - DAY_MS) }],
    mutes: [{ handle: "carol", since: new Date(T0 - 200) }],
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
  const deps: AccountDeps = {
    auth: {
      startDeletion: notHere,
      confirmDeletion: notHere,
      pendingPurges: notHere,
      finishPurge: notHere,
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
        profile: { handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: new Date(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"] },
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
    limits: new MemoryStore(() => t),
    log: silent,
    now: () => new Date(t),
  };
  return {
    deps,
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
    profile: { handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: iso(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"] },
    posts: h.lists.posts.map((post) => ({
      id: post.id,
      body: post.body,
      createdAt: post.createdAt.toISOString(),
      replyToId: post.replyToId,
      quoteOfId: post.quoteOfId,
      state: post.state,
      deletedAt: post.deletedAt ? post.deletedAt.toISOString() : null,
      media: post.media.map((image) => ({ id: image.id, file: `media/${image.id}.webp`, altText: image.altText, width: image.width, height: image.height })),
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
    });
  }
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
    expect(json.profile).toEqual({ handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: iso(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"] });
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
    });
    expect(json.posts[1]).toEqual({ id: h.deletedId, body: "", createdAt: iso(T0 - DAY_MS), replyToId: h.postId, quoteOfId: null, state: "deleted_by_author", deletedAt: iso(T0 - 1_000), media: [] });
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
    const order: (keyof Lists)[] = ["posts", "likes", "reposts", "bookmarks", "following", "blocks", "mutes"];
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

  test("a large account's export.json comes in several pieces of at most 64 KiB of UTF-8", async () => {
    const h = harness();
    const accented = String.fromCharCode(0xe9).repeat(200);
    for (let i = 0; i < 3_000; i++) h.lists.likes.push({ postId: randomUUID(), at: new Date(T0 - 100_000 + i) });
    for (let i = 0; i < 1_000; i++) h.lists.posts.push({ id: randomUUID(), body: accented, createdAt: new Date(T0 - 50_000 + i), replyToId: null, quoteOfId: null, state: "visible", deletedAt: null, media: [] });
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
      sessionId: h.currentSession,
      userId: h.userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: h.now(),
      handle: randomUUID(),
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
```

### Replace `apps/api/test/auth/deletion.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { AuthError } from "../../src/auth/context";
import { randomToken } from "../../src/auth/crypto";
import { DELETE_STARTS_PER_HOUR, confirmDeletion, finishPurge, startDeletion } from "../../src/auth/flows/deletion";
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS, MIN_START_RESPONSE_MS, flowKey, startEmail } from "../../src/auth/flows/email";
import { passwordSignIn } from "../../src/auth/flows/password";
import { HOUR, MINUTE } from "../../src/auth/limits";
import { hashPassword } from "../../src/auth/passwords";
import type { Session } from "../../src/auth/sessions";
import { memoryFlowHarness, type MemoryFlowHarness } from "./flow-harness";

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

/** Starts a deletion and returns its flow id with the code from the mail to the account's address. */
async function start(h: MemoryFlowHarness, session: Session, email: string) {
  const { flowId } = await startDeletion(h.deps, session, h.ctx);
  return { flowId, code: h.mailer.lastCodeFor(email)! };
}

describe("account deletion: the start step", () => {
  test("mails a code to the account's own address, keeps the pending deletion under the hashed flow id, and changes nothing else", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId } = await startDeletion(h.deps, ada.session, h.ctx);
    expect(flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(h.mailer.sent.map((m) => [m.to, m.template, Object.keys(m.data)])).toEqual([["ada@korbat.local", "delete_account_code", ["code"]]]);
    const expiresAt = new Date(h.now().getTime() + CODE_TTL_MS);
    expect(h.codes.map((c) => [c.email, c.purpose, c.userId, c.ipHash, c.expiresAt, c.attempts])).toEqual([["ada@korbat.local", "delete_account", ada.user.id, h.ctx.ipHash, expiresAt, 0]]);
    expect(JSON.parse((await h.kv.get(flowKey(flowId)))!)).toEqual({ userId: ada.user.id });
    expect(h.users.get(ada.user.id)!.deletedAt).toBeNull();
    expect(h.sessions.filter((s) => s.revokedAt !== null)).toEqual([]);
    expect(h.events).toEqual([]);
  });

  test("allows 3 starts an hour per account, then rate_limited with a Retry-After until the window passes", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    for (let i = 0; i < DELETE_STARTS_PER_HOUR; i++) await startDeletion(h.deps, ada.session, h.ctx);
    const refused = await failure(startDeletion(h.deps, ada.session, h.ctx));
    expect(refused).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: HOUR / 1000 });
    expect(h.mailer.sent).toHaveLength(DELETE_STARTS_PER_HOUR);
    expect(await h.kv.get(`rl:delete-start:${ada.user.id}`)).toBe(String(DELETE_STARTS_PER_HOUR + 1));
    // Another account's window is its own.
    const bob = h.user("bob@korbat.local");
    await startDeletion(h.deps, bob.session, h.ctx);
    h.advance(HOUR + 1);
    await startDeletion(h.deps, ada.session, h.ctx);
    expect(h.mailer.sent.map((m) => m.to)).toEqual(["ada@korbat.local", "ada@korbat.local", "ada@korbat.local", "bob@korbat.local", "ada@korbat.local"]);
  });
});

describe("account deletion: the confirmation", () => {
  test("the typed handle must be the account's own, in any case, and is checked before the code, so a slip costs no attempt", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local", "ada_l");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    const mismatch = await failure(confirmDeletion(h.deps, ada.session, { flowId, code: wrong(code), handle: "ada_" }));
    expect(mismatch).toMatchObject({ code: "invalid_request", status: 400, message: "handle_mismatch" });
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "bob" }))).toMatchObject({ code: "invalid_request", status: 400, message: "handle_mismatch" });
    expect(h.codes[0]!.attempts).toBe(0);
    expect(h.users.get(ada.user.id)!.deletedAt).toBeNull();
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code"]);
    expect(h.events).toEqual([]);
    // The handle compares case-insensitively: what the owner types may differ in case from what they chose.
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ADA_L" });
    expect(h.users.get(ada.user.id)!.deletedAt).toEqual(h.now());
  });

  test("a wrong code is invalid_code and counts an attempt; another account's flow, an unknown flow and an expired code are refused; five wrong codes exhaust it", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const bob = h.user("bob@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code: wrong(code), handle: "ada" }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(h.codes[0]!.attempts).toBe(1);
    // A flow another account started is no code at all for this one, settled before an attempt is counted.
    expect(await failure(confirmDeletion(h.deps, bob.session, { flowId, code, handle: "bob" }))).toMatchObject({ code: "invalid_code", status: 400 });
    expect(h.codes[0]!.attempts).toBe(1);
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId: randomToken(), code, handle: "ada" }))).toMatchObject({ code: "invalid_code", status: 400 });
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) {
      expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code: wrong(code), handle: "ada" }))).toMatchObject({ code: "invalid_code" });
    }
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" }))).toMatchObject({ code: "too_many_attempts", status: 429 });

    const again = await start(h, ada.session, "ada@korbat.local");
    h.advance(CODE_TTL_MS + 1);
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId: again.flowId, code: again.code, handle: "ada" }))).toMatchObject({ code: "code_expired", status: 400 });

    for (const user of [ada, bob]) expect(h.users.get(user.user.id)!.deletedAt).toBeNull();
    expect(h.sessions.filter((s) => s.revokedAt !== null)).toEqual([]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code", "delete_account_code"]);
    expect(h.events).toEqual([]);
  });

  test("tells the address, marks the account deleted, revokes every session with a tombstone, deletes devices, codes and passkeys with the WebAuthn user handle, records the event, and spends the code", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    const bob = h.user("bob@korbat.local");
    // A passkey each, on accounts that both hold a WebAuthn user handle: ada's passkey and handle go with the take-down, bob's stay.
    h.passkey(ada.user.id);
    const bobs = h.passkey(bob.user.id);
    h.users.get(ada.user.id)!.webauthnUserId = Buffer.alloc(32, 7);
    h.users.get(bob.user.id)!.webauthnUserId = Buffer.alloc(32, 8);
    // A sign-in code out for ada, and one for bob: the account's codes go, nobody else's.
    for (const user of [ada, bob]) {
      await h.deps.repo.createEmailCode({ flowId: randomToken(), email: user.user.email, userId: user.user.id, purpose: "login", codeHash: "h", expiresAt: new Date(h.now().getTime() + CODE_TTL_MS), ipHash: h.ctx.ipHash });
    }
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    h.advance(1000);
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });

    expect(h.mailer.sent.map((m) => [m.to, m.template])).toEqual([
      ["ada@korbat.local", "delete_account_code"],
      ["ada@korbat.local", "account_deleted"],
    ]);
    const stored = h.users.get(ada.user.id)!;
    expect(stored.deletedAt).toEqual(h.now());
    // The row is anonymised by the purge, not here: the address and the credentials are still in place for the moment.
    expect([stored.email, stored.purgedAt]).toEqual(["ada@korbat.local", null]);
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
    expect(h.sessions.filter((s) => s.userId === bob.user.id).map((s) => s.revokedAt)).toEqual([null]);
    expect(await h.kv.get(`sess:${bob.session.sessionId}`)).toBeNull();
    expect(h.devices.map((d) => d.userId)).toEqual([bob.user.id]);
    expect(h.codes.map((c) => [c.userId, c.purpose])).toEqual([[bob.user.id, "login"]]);
    expect(h.passkeys.map((p) => p.id)).toEqual([bobs]);
    expect(stored.webauthnUserId).toBeNull();
    expect(h.users.get(bob.user.id)!.webauthnUserId).toEqual(Buffer.alloc(32, 8));
    expect(h.events).toEqual([{ userId: ada.user.id, type: "account_deleted", deviceId: ada.session.deviceId, metadata: {} }]);
    expect(await h.kv.get(flowKey(flowId))).toBeNull();
    // The account is gone for every purpose: the same session cannot confirm again, whatever it sends.
    expect(await failure(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" }))).toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(await failure(startDeletion(h.deps, ada.session, h.ctx))).toMatchObject({ code: "invalid_credentials", status: 401 });
  });

  test("the notice is best effort: a mail failure does not stop the deletion", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    h.mailer.failing = true;
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });
    expect(h.users.get(ada.user.id)!.deletedAt).toEqual(h.now());
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code"]);
    expect(h.events.map((e) => e.type)).toEqual(["account_deleted"]);
  });

  test("a take-down whose transaction fails midway leaves the account live with its sessions, devices and codes, and tells nobody", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    await h.deps.repo.createEmailCode({ flowId: randomToken(), email: "ada@korbat.local", userId: ada.user.id, purpose: "login", codeHash: "h", expiresAt: new Date(h.now().getTime() + CODE_TTL_MS), ipHash: h.ctx.ipHash });
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    h.faults.add("takeDown");
    await expect(confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" })).rejects.toThrow(/midway/);

    expect(h.users.get(ada.user.id)!.deletedAt).toBeNull();
    expect(await h.deps.repo.findUserById(ada.user.id)).toBeDefined();
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([null, null]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:${id}`), id).toBeNull();
    expect(h.devices.filter((d) => d.userId === ada.user.id)).toHaveLength(2);
    expect(h.codes.map((c) => c.purpose)).toEqual(["login", "delete_account"]);
    expect(h.events).toEqual([]);
    // Nobody is told the account is gone while it is not.
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code"]);

    // The code is spent, but the account is its owner's, who can start again and finish.
    h.faults.clear();
    const again = await start(h, ada.session, "ada@korbat.local");
    await confirmDeletion(h.deps, ada.session, { flowId: again.flowId, code: again.code, handle: "ada" });
    expect(h.users.get(ada.user.id)!.deletedAt).toEqual(h.now());
  });

  test("a cache failure after the take-down does not fail the confirmation: the rows are revoked, the owner is told, and only the tombstones are missing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    const set = h.kv.set.bind(h.kv);
    h.kv.set = async () => {
      throw new Error("the cache is unreachable");
    };
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });
    h.kv.set = set;
    expect(h.users.get(ada.user.id)!.deletedAt).toEqual(h.now());
    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now()]);
    expect(h.devices.filter((d) => d.userId === ada.user.id)).toEqual([]);
    expect(h.events.map((e) => e.type)).toEqual(["account_deleted"]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["delete_account_code", "account_deleted"]);
    // A cached copy of the session can live out its minute; the revoked row is what every other lookup reads.
    expect(await h.kv.get(`sess:${ada.session.sessionId}`)).toBeNull();
  });
});

describe("account deletion: the purge's last step", () => {
  test("repeats step 1's rows for an account marked deleted by hand, with tombstones, the passkey and the WebAuthn user handle included, then anonymises the row; a repeat changes nothing", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const other = h.session(ada.user.id);
    Object.assign(h.users.get(ada.user.id)!, { passwordHash: "hash", phoneHash: "phone", totpSecretEnc: "v1:secret", totpEnabledAt: h.now(), recoveryCodesHash: ["r"], webauthnUserId: Buffer.alloc(32, 7) });
    h.passkey(ada.user.id);
    await h.deps.repo.createEmailCode({ flowId: randomToken(), email: "ada@korbat.local", userId: ada.user.id, purpose: "login", codeHash: "h", expiresAt: new Date(h.now().getTime() + CODE_TTL_MS), ipHash: h.ctx.ipHash });
    const bob = h.user("bob@korbat.local");
    // Marked deleted and nothing else, as a take-down that stopped after the mark would leave it.
    await h.deps.repo.markDeleted(ada.user.id, h.now());
    h.advance(1000);
    await finishPurge(h.deps, ada.user.id);

    expect(h.sessions.filter((s) => s.userId === ada.user.id).map((s) => s.revokedAt)).toEqual([h.now(), h.now()]);
    for (const id of [ada.session.sessionId, other.sessionId]) expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
    expect(h.devices.map((d) => d.userId)).toEqual([bob.user.id]);
    expect(h.codes).toEqual([]);
    expect(h.passkeys).toEqual([]);
    expect(h.users.get(ada.user.id)).toMatchObject({
      email: `deleted:${ada.user.id}`,
      webauthnUserId: null,
      passwordHash: null,
      phoneHash: null,
      totpSecretEnc: null,
      totpEnabledAt: null,
      recoveryCodesHash: [],
      termsVersion: null,
      purgedAt: h.now(),
    });
    // Nothing is recorded or sent: the event and the notice belong to the confirmation.
    expect(h.events).toEqual([]);
    expect(h.mailer.sent).toEqual([]);

    const purged = structuredClone(h.users.get(ada.user.id));
    h.advance(1000);
    await finishPurge(h.deps, ada.user.id);
    expect(h.users.get(ada.user.id)).toEqual(purged);
  });

  test("leaves a live account alone", async () => {
    const h = memoryFlowHarness();
    const bob = h.user("bob@korbat.local");
    await finishPurge(h.deps, bob.user.id);
    expect(h.sessions.map((s) => s.revokedAt)).toEqual([null]);
    expect(await h.kv.get(`sess:${bob.session.sessionId}`)).toBeNull();
    expect(h.devices).toHaveLength(1);
    expect(h.users.get(bob.user.id)).toMatchObject({ email: "bob@korbat.local", deletedAt: null, purgedAt: null });
  });
});

describe("a deleted account is invisible to sign-in", () => {
  test("the sign-in start treats the address as unknown, in the same shape and time; password sign-in is invalid_credentials and records no failure", async () => {
    const h = memoryFlowHarness();
    const ada = h.user("ada@korbat.local");
    const password = "correct horse battery staple";
    h.users.get(ada.user.id)!.passwordHash = await hashPassword(password);
    const device = { deviceId: randomToken(), platform: "web" as const };

    // While the account lives: the start sends a sign-in code, and a wrong password is a recorded failure.
    await startEmail(h.deps, { email: "ada@korbat.local", turnstileToken: "ok", ...device }, h.ctx);
    expect(h.codes.map((c) => c.purpose)).toEqual(["login"]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["sign_in_code"]);
    expect(await failure(passwordSignIn(h.deps, { email: "ada@korbat.local", password: "not it", turnstileToken: "ok", ...device }, h.ctx))).toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(h.events.map((e) => e.type)).toEqual(["signin_failure"]);
    expect(h.users.get(ada.user.id)!.failedLogins).toBe(1);

    const { flowId, code } = await start(h, ada.session, "ada@korbat.local");
    await confirmDeletion(h.deps, ada.session, { flowId, code, handle: "ada" });
    expect(h.events.map((e) => e.type)).toEqual(["signin_failure", "account_deleted"]);

    // Past the address's cooldown: the start now answers as for an address without an account, in the same shape and time.
    h.advance(MINUTE + 1);
    const startedAt = Date.now();
    const started = await startEmail(h.deps, { email: "ada@korbat.local", turnstileToken: "ok", ...device }, h.ctx);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(MIN_START_RESPONSE_MS - 10);
    expect(Object.keys(started)).toEqual(["flowId"]);
    expect(h.codes.map((c) => [c.purpose, c.userId])).toEqual([["signup", null]]);
    expect(h.mailer.sent.map((m) => m.template)).toEqual(["sign_in_code", "delete_account_code", "account_deleted", "sign_up_code"]);
    // The right password no longer signs in, and the failure counter and the event log do not move: there is no account to record against.
    expect(await failure(passwordSignIn(h.deps, { email: "ada@korbat.local", password, turnstileToken: "ok", ...device }, h.ctx))).toMatchObject({ code: "invalid_credentials", status: 401 });
    expect(h.events.map((e) => e.type)).toEqual(["signin_failure", "account_deleted"]);
    expect(h.users.get(ada.user.id)!.failedLogins).toBe(1);
  });
});
```

### Replace `apps/api/test/auth/flow-harness.ts` (whole file)

```ts
import { randomUUID } from "node:crypto";
import type { Platform } from "@korbat/contracts";
import pino from "pino";
import type { AuthConfig, AuthDeps, RequestContext } from "../../src/auth/context";
import { parseVersionedKey, randomToken, sha256Hex } from "../../src/auth/crypto";
import { MemoryKv } from "../../src/auth/kv";
import { createLockout } from "../../src/auth/lockout";
import type { ActiveSessionRow, AddPasskeyOutcome, AuthEventType, AuthRepo, DeviceRow, EmailCodeRow, NewPasskey, PasskeyLimits, PasskeyListRow, PasskeyRow, UserRow } from "../../src/auth/repo";
import { createSessions, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, type Factors, type Session } from "../../src/auth/sessions";
import { devProvider } from "../../src/auth/verify/dev";
import { MemoryMailer } from "../../src/mail/memory";

export interface RecordedEvent {
  userId: string | null;
  type: AuthEventType;
  deviceId: string | null;
  metadata: Record<string, unknown>;
}

export const TEST_TERMS = "draft-test";

/**
 * A session of a user, as the deletion and lockdown flows revoke it and, since Task 5, as the sign-in and re-authentication
 * flows issue, resolve and rotate it. The first three fields are all those older flows read; the rest let findActiveSession
 * answer a full row.
 */
export interface RecordedSession {
  id: string;
  userId: string;
  revokedAt: Date | null;
  deviceId: string;
  handle: string;
  factors: Record<string, number>;
  passkeyId: string | null;
  reauthAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface RecordedDevice {
  id: string;
  userId: string;
  revokedAt: Date | null;
  /** What the passkey flows read of the row: the platform for a passkey's default name and the label for the Security list. */
  platform: Platform;
  label: string | null;
  /** The keyed hash a sign-in looks a device up by; absent on the devices h.session and h.user seed, which no lookup finds. */
  deviceHash?: string;
}

/** A passkey of a user, as the registration writes it and the lockdown and the management flows read it. */
export type RecordedPasskey = PasskeyRow;

/**
 * The auth flows without a database: users, email codes, sessions, devices and passkeys live in memory, and the
 * repository fake holds only the methods the email-change (with its undo link), badge, deletion, not-me and
 * lockdown flows call (and the lookups the sign-in starts make), checked against the real signatures. The key-value store and the
 * mailer are the in-memory ones; the clock moves only when a test says so, so expiries and timestamps
 * compare exactly; and events are kept as the server would write them to auth_events. The integration
 * harness (test/integration/flow-harness.ts) runs flows against the real repository instead.
 */
export function memoryFlowHarness(start = 1_789_000_000_000) {
  let t = start;
  const now = () => new Date(t);
  const users = new Map<string, UserRow>();
  const codes: EmailCodeRow[] = [];
  const events: RecordedEvent[] = [];
  const sessions: RecordedSession[] = [];
  const devices: RecordedDevice[] = [];
  const passkeys: RecordedPasskey[] = [];
  /**
   * When each event was recorded, at the harness clock, kept beside the events rather than on them: the tests compare
   * the events with the exact objects the flows write, and the daily passkey bound is the only reader of the times.
   */
  const eventTimes = new WeakMap<RecordedEvent, number>();
  const recordEvent = (event: RecordedEvent) => {
    events.push(event);
    eventTimes.set(event, t);
  };
  /** The handle of each account's profile, which the deletion flow compares the typed handle with. */
  const handles = new Map<string, string>();
  /** Repository methods told to fail: "takeDown" fails its transaction midway, after staging its writes and before any lands. */
  const faults = new Set<"takeDown">();
  /** A device as the real row reads, from what the harness keeps of it; the hash and the times are placeholders no flow reads here. */
  const deviceRow = (device: RecordedDevice): DeviceRow => ({
    id: device.id,
    userId: device.userId,
    deviceHash: device.deviceHash ?? `hash-${device.id}`,
    label: device.label,
    platform: device.platform,
    firstSeenAt: now(),
    lastSeenAt: now(),
    ipHash: null,
    revokedAt: device.revokedAt,
  });
  /** A passkey with the label of the device that added it, as the real join answers it: null once that device is gone. */
  const withDevice = (passkey: RecordedPasskey): PasskeyListRow => ({ ...passkey, createdOn: devices.find((d) => d.id === passkey.createdDeviceId)?.label ?? null });
  /**
   * The daily bound's reading, as the real statement makes it: the times of the account's latest passkey_added events within
   * the window, at most `limit` of them, and the seconds until the oldest of those leaves the window.
   */
  const recentPasskeyAdditions = (userId: string, withinMs: number, limit: number) => {
    const recent = events
      .filter((e) => e.userId === userId && e.type === "passkey_added")
      .map((e) => eventTimes.get(e)!)
      .filter((at) => at > t - withinMs)
      .sort((a, b) => b - a)
      .slice(0, limit);
    const oldest = recent.at(-1);
    return { count: recent.length, retryAfterSeconds: oldest === undefined ? 0 : Math.ceil((oldest + withinMs - t) / 1000) };
  };
  /**
   * Step 1's rows for a user, as the real repository's takeDownRows writes them: live sessions revoked (their ids
   * returned), devices, codes and passkeys gone, and the WebAuthn user handle cleared (1c design, section 7.7).
   */
  const takeDownRows = (userId: string, at: Date): string[] => {
    const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
    for (const s of live) s.revokedAt = at;
    for (let i = devices.length - 1; i >= 0; i--) if (devices[i]!.userId === userId) devices.splice(i, 1);
    for (let i = codes.length - 1; i >= 0; i--) if (codes[i]!.userId === userId) codes.splice(i, 1);
    for (let i = passkeys.length - 1; i >= 0; i--) if (passkeys[i]!.userId === userId) passkeys.splice(i, 1);
    const row = users.get(userId);
    if (row) row.webauthnUserId = null;
    return live.map((s) => s.id);
  };
  const repo = {
    async findUserById(id: string): Promise<UserRow | undefined> {
      const row = users.get(id);
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      // As the real lookup: the address in any case, and never a deleted row.
      const row = [...users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());
      return row && row.deletedAt === null ? { ...row } : undefined;
    },
    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      const row = users.get(userId);
      if (row) {
        row.failedLogins = failedLogins;
        row.lockedUntil = lockedUntil;
      }
    },
    async createEmailCode(input: Parameters<AuthRepo["createEmailCode"]>[0]): Promise<void> {
      codes.push({ id: randomUUID(), ...input, attempts: 0, consumedAt: null, createdAt: now() });
    },
    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const row = codes.find((c) => c.flowId === flowId);
      return row ? { ...row } : undefined;
    },
    async addCodeAttempt(id: string): Promise<number> {
      const row = codes.find((c) => c.id === id);
      if (!row) return Number.MAX_SAFE_INTEGER;
      row.attempts += 1;
      return row.attempts;
    },
    async consumeEmailCode(id: string, at: Date): Promise<boolean> {
      const row = codes.find((c) => c.id === id);
      if (!row || row.consumedAt !== null) return false;
      row.consumedAt = at;
      return true;
    },
    async changeEmail(userId: string, email: string, at: Date): Promise<void> {
      // As the real unique index on lower(email), deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      for (const other of users.values()) {
        if (other.id !== userId && other.email.toLowerCase() === email.toLowerCase()) {
          throw Object.assign(new Error('duplicate key value violates unique constraint "users_email_lower_idx"'), { code: "23505" });
        }
      }
      const row = users.get(userId);
      if (!row) return;
      row.email = email;
      row.emailVerifiedAt = at;
    },
    async setPasswordHash(userId: string, passwordHash: string | null, at: Date): Promise<void> {
      // As the real statement: setting or clearing a password also clears any lockout, and records when.
      const row = users.get(userId);
      if (row) Object.assign(row, { passwordHash, passwordChangedAt: at, failedLogins: 0, lockedUntil: null });
    },
    async revokeDevices(userId: string, at: Date): Promise<void> {
      for (const device of devices) if (device.userId === userId && device.revokedAt === null) device.revokedAt = at;
    },
    async disableTotp(userId: string): Promise<void> {
      const row = users.get(userId);
      if (row) Object.assign(row, { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] });
    },
    async deletePasskeys(userId: string, input: { since: Date; ids: readonly string[] }): Promise<string[]> {
      // As the real statement: the user's passkeys created at or after `since`, plus any of theirs the caller names.
      const removed: string[] = [];
      for (let i = passkeys.length - 1; i >= 0; i--) {
        const passkey = passkeys[i]!;
        if (passkey.userId !== userId) continue;
        if (passkey.createdAt.getTime() >= input.since.getTime() || input.ids.includes(passkey.id)) {
          removed.push(passkey.id);
          passkeys.splice(i, 1);
        }
      }
      return removed;
    },
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      // As the real partial unique index on phone_hash, deleted rows included: the driver error that the flow recognises through isUniqueViolation.
      if (phoneHash !== null) {
        for (const other of users.values()) {
          if (other.id !== userId && other.phoneHash === phoneHash) {
            throw Object.assign(new Error('duplicate key value violates unique constraint "users_phone_hash_idx"'), { code: "23505" });
          }
        }
      }
      const row = users.get(userId);
      if (row) row.phoneHash = phoneHash;
    },
    async appendEvent(input: Parameters<AuthRepo["appendEvent"]>[0]): Promise<void> {
      recordEvent({ userId: input.userId, type: input.type, deviceId: input.deviceId ?? null, metadata: input.metadata ?? {} });
    },
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const device = devices.find((d) => d.id === id);
      return device ? deviceRow(device) : undefined;
    },
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      // As the real compare-and-set: the first candidate sticks, every later call reads it back.
      const row = users.get(userId);
      if (!row || row.deletedAt !== null) return undefined;
      row.webauthnUserId ??= candidate;
      return row.webauthnUserId;
    },
    async countPasskeys(userId: string): Promise<number> {
      return passkeys.filter((p) => p.userId === userId).length;
    },
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      // Newest first, as the real statement orders them.
      return passkeys
        .filter((p) => p.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(withDevice);
    },
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const passkey = passkeys.find((p) => p.id === id && p.userId === userId);
      return passkey ? withDevice(passkey) : undefined;
    },
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(userId, withinMs, limit);
    },
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      // As the real transaction: the account locked, both bounds checked again, then the row and its event, or nothing.
      const row = users.get(input.userId);
      if (!row || row.deletedAt !== null) return { ok: false, reason: "gone" };
      if (passkeys.filter((p) => p.userId === input.userId).length >= limits.passkeys) return { ok: false, reason: "cap" };
      const additions = recentPasskeyAdditions(input.userId, limits.windowMs, limits.additions);
      if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
      // As the real unique index on credential_id: the driver error that the flow recognises through isUniqueViolation.
      if (passkeys.some((p) => p.credentialId === input.credentialId)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint "passkeys_credential_idx"'), { code: "23505" });
      }
      const passkey: RecordedPasskey = { id: randomUUID(), lastUsedAt: null, suspectAt: null, ...input };
      passkeys.push(passkey);
      recordEvent({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey.id } });
      return { ok: true, passkey: { ...passkey } };
    },
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const passkey = passkeys.find((p) => p.id === id && p.userId === userId);
      if (!passkey) return false;
      passkey.name = name;
      return true;
    },
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const index = passkeys.findIndex((p) => p.id === id && p.userId === userId);
      if (index === -1) return undefined;
      const [removed] = passkeys.splice(index, 1);
      return { name: removed!.name };
    },
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      // As the real lookup: any account's, and the flow refuses a deleted owner through findUserById.
      const passkey = passkeys.find((p) => p.credentialId === credentialId);
      return passkey ? { ...passkey } : undefined;
    },
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const passkey = passkeys.find((p) => p.credentialId === credentialId && p.userId === userId);
      return passkey ? { ...passkey } : undefined;
    },
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, at: Date): Promise<boolean> {
      // As the real conditional update: a suspect passkey never matches, and the counter must move forward unless both are zero.
      const passkey = passkeys.find((p) => p.id === id);
      if (!passkey || passkey.suspectAt !== null) return false;
      if (!((newCounter === 0 && passkey.counter === 0) || newCounter > passkey.counter)) return false;
      passkey.counter = newCounter;
      passkey.lastUsedAt = at;
      passkey.backedUp = backedUp;
      return true;
    },
    async suspectPasskey(id: string, at: Date): Promise<void> {
      const passkey = passkeys.find((p) => p.id === id);
      if (passkey && passkey.suspectAt === null) passkey.suspectAt = at;
    },
    async findDevice(userId: string, deviceHashValue: string): Promise<DeviceRow | undefined> {
      const device = devices.find((d) => d.userId === userId && d.deviceHash === deviceHashValue && d.revokedAt === null);
      return device ? deviceRow(device) : undefined;
    },
    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const device: RecordedDevice = { id: randomUUID(), userId: input.userId, revokedAt: null, platform: input.platform as Platform, label: input.label, deviceHash: input.deviceHash };
      devices.push(device);
      return deviceRow(device);
    },
    async touchDevice(): Promise<void> {
      // The row's last-seen and ip are placeholders no flow reads here, so touching it changes nothing observable.
    },
    async createSession(input: {
      id: string;
      userId: string;
      deviceId: string;
      now: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      factors?: Record<string, number>;
      passkeyId?: string | null;
    }): Promise<void> {
      // As the real insert: the reauth time is the latest of the factors, and a fresh handle stands in for the column's default.
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      sessions.push({
        id: input.id,
        userId: input.userId,
        revokedAt: null,
        deviceId: input.deviceId,
        handle: randomUUID(),
        factors,
        passkeyId: input.passkeyId ?? null,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        createdAt: input.now,
        lastUsedAt: input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      });
    },
    async findActiveSession(id: string, at: Date): Promise<ActiveSessionRow | undefined> {
      // As the real joins: the session, its account and its device must all be live.
      const row = sessions.find((s) => s.id === id && s.revokedAt === null && s.expiresAt > at && s.absoluteExpiresAt > at);
      if (!row) return undefined;
      const user = users.get(row.userId);
      if (!user || user.deletedAt !== null) return undefined;
      const device = devices.find((d) => d.id === row.deviceId && d.revokedAt === null);
      if (!device) return undefined;
      return {
        id: row.id,
        userId: row.userId,
        deviceId: row.deviceId,
        role: user.role,
        onboardedAt: user.onboardedAt,
        totpEnabledAt: user.totpEnabledAt,
        reauthAt: row.reauthAt,
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
        handle: row.handle,
        factors: row.factors,
        passkeyId: row.passkeyId,
      };
    },
    async rotateSession(id: string, newId: string): Promise<boolean> {
      // As the real statement: the primary key changes in place for a live row, and everything else stays.
      const row = sessions.find((s) => s.id === id && s.revokedAt === null);
      if (!row) return false;
      row.id = newId;
      return true;
    },
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      // As the real statement: the kind's time is set or replaced and the reauth time follows it.
      const row = sessions.find((s) => s.id === id);
      if (!row) return;
      row.factors = { ...row.factors, [kind]: at.getTime() };
      row.reauthAt = at;
    },
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      // As the real conditional update: a step no later than the last accepted one is refused, so a code cannot be reused.
      const row = users.get(userId);
      if (!row || (row.totpLastStep !== null && row.totpLastStep >= step)) return false;
      row.totpLastStep = step;
      return true;
    },
    async revokeAllSessions(userId: string, at: Date): Promise<string[]> {
      const live = sessions.filter((s) => s.userId === userId && s.revokedAt === null);
      for (const s of live) s.revokedAt = at;
      return live.map((s) => s.id);
    },
    async markDeleted(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
    },
    async takeDown(userId: string, at: Date, deviceId: string | null): Promise<string[]> {
      // One transaction, as the real one: when it fails midway nothing it would have written lands.
      if (faults.has("takeDown")) throw new Error("the take-down transaction failed midway and was rolled back");
      const row = users.get(userId);
      if (row && row.deletedAt === null) row.deletedAt = at;
      const revoked = takeDownRows(userId, at);
      recordEvent({ userId, type: "account_deleted", deviceId, metadata: {} });
      return revoked;
    },
    async finishTakeDown(userId: string, at: Date): Promise<string[]> {
      // As the real statement: only a row marked deleted and not purged yet.
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return [];
      return takeDownRows(userId, at);
    },
    async finishPurge(userId: string, at: Date): Promise<void> {
      const row = users.get(userId);
      if (!row || row.deletedAt === null || row.purgedAt !== null) return;
      Object.assign(row, {
        email: `deleted:${userId}`,
        emailVerifiedAt: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
        phoneHash: null,
        ageConfirmedAt: null,
        termsVersion: null,
        termsAcceptedAt: null,
        purgedAt: at,
      });
    },
  } satisfies Pick<
    AuthRepo,
    | "findUserById"
    | "findUserByEmail"
    | "setPasswordFailures"
    | "createEmailCode"
    | "findEmailCode"
    | "addCodeAttempt"
    | "consumeEmailCode"
    | "changeEmail"
    | "setPasswordHash"
    | "revokeDevices"
    | "disableTotp"
    | "deletePasskeys"
    | "setPhoneHash"
    | "appendEvent"
    | "findDeviceById"
    | "ensureWebauthnUserId"
    | "countPasskeys"
    | "listPasskeys"
    | "findPasskey"
    | "recentPasskeyAdditions"
    | "addPasskey"
    | "renamePasskey"
    | "deletePasskey"
    | "findPasskeyByCredentialId"
    | "findPasskeyByCredential"
    | "claimPasskeyUse"
    | "suspectPasskey"
    | "findDevice"
    | "createDevice"
    | "touchDevice"
    | "createSession"
    | "findActiveSession"
    | "rotateSession"
    | "writeFactor"
    | "claimTotpStep"
    | "revokeAllSessions"
    | "markDeleted"
    | "takeDown"
    | "finishTakeDown"
    | "finishPurge"
  >;
  const authRepo = repo as unknown as AuthRepo;
  const kv = new MemoryKv(() => t);
  const mailer = new MemoryMailer();
  /** profiles.verified_at by account, as the badge flows set and clear it through the profile store. */
  const verified = new Map<string, Date | null>();
  const config: AuthConfig = {
    appOrigin: "http://localhost:8081",
    allowedOrigins: ["http://localhost:8081"],
    authHmacKey: Buffer.alloc(32, 3),
    ipHashKey: Buffer.alloc(32, 4),
    totpKey: parseVersionedKey(`v1:${Buffer.alloc(32, 5).toString("base64")}`),
    totpPreviousKeys: [],
    termsVersion: TEST_TERMS,
    trustProxy: "none",
    verifyProvider: "dev",
    webauthn: { rpId: "localhost", rpName: "korbat", origins: ["http://localhost:8081"] },
  };
  const deps: AuthDeps = {
    repo: authRepo,
    kv,
    sessions: createSessions({ repo: authRepo, kv, now }),
    lockout: createLockout({ repo: authRepo, kv, now }),
    mailer,
    turnstile: { verify: async () => true },
    breachChecker: { isBreached: async () => false },
    // The flows this harness runs create no profile; the badge flows only set and clear verified_at, kept above by
    // account, and the deletion flow reads the handle, kept by account as `user` registers it.
    profiles: {
      create: async () => {
        throw new Error("the memory harness has no profile store");
      },
      find: async (id) => {
        const handle = handles.get(id);
        return handle === undefined ? null : { id, handle, displayName: handle, handleChangedAt: null, verified: (verified.get(id) ?? null) !== null };
      },
      setVerified: async (id, at) => {
        verified.set(id, at);
      },
    },
    // The development provider, which accepts exactly 000000; a test swaps it for null or a scripted one.
    verify: devProvider(),
    config,
    log: pino({ level: "silent" }),
    now,
  };
  const ctx: RequestContext = { ipHash: randomToken(), userAgent: undefined };
  /**
   * A live session on a device of its own, both recorded as the deletion flow will find them. It proved an email code
   * just now unless given other factors, as a session behind requireFreshAuth has, and started from no passkey unless told so.
   * The device is a web browser labelled as the sign-in labels one, unless the test says otherwise.
   */
  const session = (userId: string, options: { factors?: Factors; passkeyId?: string | null; platform?: Platform; label?: string | null } = {}): Session => {
    const s: Session = {
      sessionId: sha256Hex(randomToken()),
      userId,
      deviceId: randomUUID(),
      role: "user",
      onboarded: true,
      mfaEnabled: false,
      reauthAt: now(),
      handle: randomUUID(),
      factors: options.factors ?? { email: t },
      passkeyId: options.passkeyId ?? null,
    };
    sessions.push({
      id: s.sessionId,
      userId,
      revokedAt: null,
      deviceId: s.deviceId,
      handle: s.handle,
      factors: s.factors,
      passkeyId: s.passkeyId,
      reauthAt: s.reauthAt,
      createdAt: now(),
      lastUsedAt: now(),
      expiresAt: new Date(t + SESSION_IDLE_MS),
      absoluteExpiresAt: new Date(t + SESSION_ABSOLUTE_MS),
    });
    devices.push({ id: s.deviceId, userId, revokedAt: null, platform: options.platform ?? "web", label: options.label === undefined ? "Chrome on Windows" : options.label });
    return s;
  };
  return {
    deps,
    kv,
    mailer,
    ctx,
    users,
    codes,
    events,
    sessions,
    devices,
    passkeys,
    verified,
    faults,
    now,
    advance(ms: number) {
      t += ms;
    },
    /** Another session of an existing account, on another device. */
    session,
    /**
     * A passkey of an existing account, created at `createdAt` (now unless given) with the row's defaults (a plain,
     * unnamed synced key added from no device) unless overridden; answers its id.
     */
    passkey(userId: string, createdAt: Date = now(), overrides: Partial<Omit<RecordedPasskey, "id" | "userId" | "createdAt">> = {}): string {
      const id = randomUUID();
      passkeys.push({
        id,
        userId,
        createdAt,
        credentialId: randomToken(),
        publicKey: "cose-key",
        counter: 0,
        transports: [],
        backedUp: false,
        name: "Passkey",
        lastUsedAt: null,
        aaguid: null,
        backupEligible: false,
        uvInitialized: false,
        createdDeviceId: null,
        suspectAt: null,
        ...overrides,
      });
      return id;
    },
    /**
     * An onboarded account holding a verified address, with a session that just proved a credential, as a route
     * behind requireFreshAuth passes it on. Its profile's handle is the address's local part unless given.
     */
    user(email: string, handle: string = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9_]/g, "_")): { user: UserRow; session: Session } {
      const id = randomUUID();
      const user: UserRow = {
        id,
        email,
        emailVerifiedAt: now(),
        phoneHash: null,
        passwordHash: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
        failedLogins: 0,
        lockedUntil: null,
        createdAt: now(),
        deletedAt: null,
        role: "user",
        ageConfirmedAt: now(),
        termsVersion: TEST_TERMS,
        termsAcceptedAt: now(),
        onboardedAt: now(),
        passwordChangedAt: null,
        totpLastStep: null,
        purgedAt: null,
        webauthnUserId: null,
      };
      users.set(id, user);
      handles.set(id, handle);
      return { user, session: session(id) };
    },
  };
}

export type MemoryFlowHarness = ReturnType<typeof memoryFlowHarness>;
```

### Replace `apps/api/test/integration/account-export.test.ts` (whole file)

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ExportFormat } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { buildExport, exportJson, writeExport } from "../../src/account/flows/export";
import { createZipWriter } from "../../src/account/zip";
import { AuthError } from "../../src/auth/context";
import { randomToken, sha256Hex } from "../../src/auth/crypto";
import { exportAccount } from "../../src/auth/flows/export";
import { signIn } from "../../src/auth/flows/signin";
import { MINUTE } from "../../src/auth/limits";
import { registerOptions, registerVerify } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import type { Session } from "../../src/auth/sessions";
import { loadConfig } from "../../src/config";
import { mediaForAccount } from "../../src/media";
import { status } from "../../src/media/flows/status";
import { upload } from "../../src/media/flows/upload";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { SocialError } from "../../src/social/context";
import { exportProfile } from "../../src/social/flows/export";
import { createPost, deletePost } from "../../src/social/flows/posts";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { TEST_TERMS, flowHarness, onboardedUser, type FlowHarness } from "./flow-harness";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { newPost } from "./social-fixtures";
import { socialHarness, type SocialHarness } from "./social-harness";

const newHandle = () => `x_${randomBytes(5).toString("hex")}`;
const ORIGIN = "http://localhost:8081";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };
const BARE: SoftFlags = { up: true, uv: false, be: false, bs: false };

/** Collects the archive in memory, copying each chunk as the sink of a response would consume it. */
function memorySink() {
  const chunks: Uint8Array[] = [];
  return {
    write: async (chunk: Uint8Array): Promise<void> => {
      chunks.push(Uint8Array.from(chunk));
    },
    bytes: (): Uint8Array => Buffer.concat(chunks),
  };
}

/**
 * The export across the three modules on real Postgres: the auth repository behind the auth flow,
 * the social repository and flows, and the media repository with both volumes in a temporary
 * directory and the stand-in for the worker. Only the account module's dependencies are composed
 * here, the way the server composes them from the module indexes.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: the data export of an account", () => {
  let apiDb: Db;
  let authDb: Db;
  let authRepo: AuthRepo;
  let h: FlowHarness;
  let m: MediaHarness;
  let s: SocialHarness;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    authRepo = createAuthRepo(authDb);
    h = flowHarness(authRepo);
    m = await mediaHarness(apiDb);
    s = socialHarness(apiDb, {
      media: {
        attach: (tx, input) => m.deps.repo.attach(tx, input),
        detachAll: (tx, postId) => m.deps.repo.detachAll(tx, postId),
        requestDeletion: (ids) => m.files.requestDeletion(ids),
        forPosts: (postIds) => m.deps.repo.forPosts(postIds),
      },
    });
  });
  afterAll(async () => {
    m.cleanup();
    await Promise.all([closeDb(apiDb), closeDb(authDb)]);
  });

  // The deletion side of the three interfaces is not exercised by the export; account-deletion.test.ts covers it.
  const notHere = async (): Promise<never> => {
    throw new Error("not exercised by the export");
  };
  const deps = (): AccountDeps => ({
    auth: {
      startDeletion: notHere,
      confirmDeletion: notHere,
      pendingPurges: notHere,
      finishPurge: notHere,
      exportAccount: (userId) => exportAccount(h.deps, userId),
      appendEvent: (userId, type, metadata) => authRepo.appendEvent({ userId, type, metadata }),
    },
    social: { purgeProfile: notHere, exportProfile: (userId, pageSize) => exportProfile(s.deps, userId, pageSize) },
    // The media module's own interface for this one, over the harness's repository and volumes.
    media: { ...mediaForAccount(m.deps), purgeOwner: notHere, requestDeletion: notHere },
    limits: new MemoryStore(),
    log: pino({ level: "silent" }),
    now: () => new Date(),
  });

  const collect = async (pieces: AsyncIterable<string>): Promise<string> => {
    let text = "";
    for await (const piece of pieces) text += piece;
    return text;
  };

  /** An auth account signed in on one device, with a profile of the same id in the public schema. */
  async function account() {
    const owner = await onboardedUser(h, authRepo, { password: "correct horse battery staple" });
    const handle = newHandle();
    const created = await createProfileStore(apiDb).create({ id: owner.user.id, handle, displayName: "Owner" });
    expect(created.ok).toBe(true);
    return { ...owner, handle };
  }

  /** A whole passkey registration through the 1c flow: the options, the software authenticator's answer and the verification; answers the stored view. */
  async function register(session: Session, auth: SoftAuthenticator, name: string | undefined, flags: SoftFlags) {
    const { options } = await registerOptions(h.deps, session, { label: "Owner" });
    const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags });
    return (await registerVerify(h.deps, session, { name, response })).passkey;
  }

  test("an account with real uploads exports an archive whose images are the store's large.webp byte for byte, and whose JSON holds its rows and its passkeys without their keys", { timeout: 30_000 }, async () => {
    const owner = await account();
    const userId = owner.user.id;
    // A second live session on the same device, and a third one revoked: only the two live ones are listed.
    const second = await signIn(h.deps, owner.user, owner.device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
    const revoked = await signIn(h.deps, owner.user, owner.device, h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
    await h.deps.sessions.revoke(revoked.issued.session.sessionId, userId);
    // Two passkeys a minute apart on the harness clock, both from the signed-in device: a synced one, used once since, and a plain one never used.
    const laptopAt = h.clock.now();
    const laptop = await register(owner.session, new SoftAuthenticator(), "Laptop", ALL);
    h.clock.advance(MINUTE);
    const plainAt = h.clock.now();
    await register(owner.session, new SoftAuthenticator(), undefined, BARE);
    const usedAt = new Date();
    expect(await authRepo.claimPasskeyUse(laptop.id, 1, true, usedAt)).toBe(true);
    // The handle left behind is reserved in handle_history; the export lists both.
    const renamed = newHandle();
    expect((await s.repo.changeHandle(userId, renamed, s.clock.next())).ok).toBe(true);

    const [imageA, imageB] = [await m.readyImage(userId, { width: 1600, height: 1200 }), await m.readyImage(userId, { width: 900, height: 1600 })];
    const post = await createPost(s.deps, userId, {
      body: "two photos",
      media: [
        { id: imageA, alt: "a harbour at dawn" },
        { id: imageB, alt: "a lighthouse" },
      ],
    });
    const reply = await createPost(s.deps, userId, { body: "a reply, soon deleted", replyToId: post.id, media: [] });
    await deletePost(s.deps, userId, reply.id);
    // A ready image on no post is still the account's upload; one still processing and one that failed have no file to export.
    const loose = await m.readyImage(userId);
    await upload(m.deps, userId, m.jpeg());
    const failed = (await upload(m.deps, userId, m.jpeg())).id;
    m.worker.failed(failed, "corrupt_image");
    await status(m.deps, userId, failed);

    const [bob, eve, carol] = await Promise.all([s.established(), s.established(), s.established()]);
    const bobsPost = await createPost(s.deps, bob.id, { body: "bob's post", media: [] });
    expect(await s.repo.like(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.repost(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.bookmark(userId, bobsPost.id, s.clock.next())).toBe(true);
    expect(await s.repo.follow(userId, bob.id, s.clock.next())).toBe(true);
    expect(await s.repo.block(userId, eve.id, s.clock.next())).toBe(true);
    expect(await s.repo.mute(userId, carol.id, s.clock.next())).toBe(true);
    await authRepo.appendEvent({ userId, type: "profile_updated" });

    const plan = await buildExport(deps(), userId, owner.session.sessionId, new Date());
    const sink = memorySink();
    await writeExport(createZipWriter(sink.write), plan);
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files).sort()).toEqual(["export.json", `media/${imageA}.webp`, `media/${imageB}.webp`, `media/${loose}.webp`].sort());
    for (const id of [imageA, imageB, loose]) {
      expect(Buffer.compare(Buffer.from(files[`media/${id}.webp`]!), readFileSync(m.files.store.image(id, "large"))), id).toBe(0);
    }
    const text = strFromU8(files["export.json"]!);
    const json = ExportFormat.parse(JSON.parse(text));
    expect(json.missingMedia).toEqual([]);

    expect(json.account).toMatchObject({ id: userId, email: owner.email, role: "user", mfaEnabled: false, hasPassword: true, verified: false, termsVersion: TEST_TERMS });
    expect(json.account.termsAcceptedAt).not.toBeNull();
    // Newest first, the times from the flows' clock and the use as it was written, and the device that added each by its label.
    expect(json.account.passkeys).toEqual([
      { name: "Passkey on the web", createdAt: plainAt.toISOString(), lastUsedAt: null, synced: false, createdOn: "Chrome on Windows" },
      { name: "Laptop", createdAt: laptopAt.toISOString(), lastUsedAt: usedAt.toISOString(), synced: true, createdOn: "Chrome on Windows" },
    ]);
    // In the archive's own text: exactly those five members, and nothing that identifies a key, not the passkey ids, the credential ids or the public keys.
    const raw = JSON.parse(text) as { account: { passkeys: Record<string, unknown>[] } };
    expect(raw.account.passkeys.map((passkey) => Object.keys(passkey))).toEqual(Array.from({ length: 2 }, () => ["name", "createdAt", "lastUsedAt", "synced", "createdOn"]));
    for (const row of await authRepo.listPasskeys(userId)) {
      for (const secret of [row.id, row.credentialId, row.publicKey]) expect(text, secret).not.toContain(secret);
    }
    // The archive's JSON is the document exactly as JSON.stringify writes it, the passkeys in their place inside the account.
    expect(text).toBe(JSON.stringify(raw, null, 2));
    expect(json.sessions.map((session) => session.id).sort()).toEqual([owner.session.sessionId, second.issued.session.sessionId].sort());
    expect(json.sessions.find((session) => session.id === owner.session.sessionId)!.current).toBe(true);
    expect(json.sessions.find((session) => session.id === second.issued.session.sessionId)!.current).toBe(false);
    expect(json.devices).toHaveLength(1);
    expect(json.devices[0]!.platform).toBe("web");
    // The account's own events, newest first; the sign-ins are among them.
    expect(json.events[0]!.type).toBe("profile_updated");
    expect(json.events.map((event) => event.type)).toContain("signin_success");
    for (let i = 1; i < json.events.length; i++) expect(json.events[i]!.at <= json.events[i - 1]!.at).toBe(true);

    expect(json.profile).toMatchObject({ handle: renamed, displayName: "Owner", bio: "", handleHistory: [owner.handle, renamed] });
    expect(json.posts.map((p) => p.id)).toEqual([post.id, reply.id]);
    expect(json.posts[0]).toMatchObject({
      body: "two photos",
      state: "visible",
      deletedAt: null,
      media: [
        { id: imageA, file: `media/${imageA}.webp`, altText: "a harbour at dawn", width: 1600, height: 1200 },
        { id: imageB, file: `media/${imageB}.webp`, altText: "a lighthouse", width: 900, height: 1600 },
      ],
    });
    expect(json.posts[1]).toMatchObject({ body: "", state: "deleted_by_author", replyToId: post.id, media: [] });
    expect(json.posts[1]!.deletedAt).not.toBeNull();
    expect(json.likes.map((ref) => ref.postId)).toEqual([bobsPost.id]);
    expect(json.reposts.map((ref) => ref.postId)).toEqual([bobsPost.id]);
    expect(json.bookmarks.map((ref) => ref.postId)).toEqual([bobsPost.id]);
    expect(json.following).toEqual([{ handle: bob.handle, since: expect.any(String) }]);
    expect(json.blocks).toEqual([{ handle: eve.handle, since: expect.any(String) }]);
    expect(json.mutes).toEqual([{ handle: carol.handle, since: expect.any(String) }]);
  });

  test("the badge and two-factor are reported as held, an account without passkeys lists none; an unknown account or profile is refused", async () => {
    const owner = await account();
    await authRepo.setPhoneHash(owner.user.id, sha256Hex(randomToken()));
    await authRepo.enableTotp(owner.user.id, { secretEnc: "v1:test", recoveryCodesHash: ["a"], now: new Date() });
    const exported = await exportAccount(h.deps, owner.user.id);
    expect(exported.account).toMatchObject({ verified: true, mfaEnabled: true, hasPassword: true });
    // An account that never registered a passkey exports an empty list, not a missing one.
    expect(exported.passkeys).toEqual([]);

    const unknown = await exportAccount(h.deps, randomUUID()).catch((err: unknown) => err);
    expect(unknown).toBeInstanceOf(AuthError);
    expect((unknown as AuthError).code).toBe("invalid_credentials");
    const nobody = await exportProfile(s.deps, randomUUID()).catch((err: unknown) => err);
    expect(nobody).toBeInstanceOf(SocialError);
    expect((nobody as SocialError).code).toBe("not_found");
    expect(await m.deps.repo.readyImages(randomUUID())).toEqual([]);
  });

  test("export.json read in keyset pages of two is, byte for byte, the document read in pages of a thousand; rows that share a moment are neither lost nor repeated", async () => {
    const owner = await account();
    const userId = owner.user.id;
    const [bob, ...others] = await Promise.all(Array.from({ length: 10 }, () => s.established()));
    const posts: string[] = [];
    for (let i = 0; i < 5; i++) posts.push(await newPost(s.repo, userId, s.clock.next(), `post ${i}`));
    const bobsPosts: string[] = [];
    for (let i = 0; i < 5; i++) bobsPosts.push(await newPost(s.repo, bob!.id, s.clock.next(), `bob ${i}`));
    // Five likes at one moment: within it the post id orders them, and a page may end between two of them.
    const moment = s.clock.next();
    for (const post of bobsPosts) expect(await s.repo.like(userId, post, moment)).toBe(true);
    // Three reposts a microsecond apart inside one millisecond, as a database default writes them: a page key cut to the
    // millisecond would read the same rows again or skip some.
    for (const [i, post] of bobsPosts.slice(0, 3).entries()) {
      await apiDb.execute(sql`insert into reposts (user_id, post_id, created_at) values (${userId}::uuid, ${post}::uuid, ${`2026-01-01T00:00:00.12345${i}Z`}::timestamptz)`);
    }
    for (const post of bobsPosts.slice(0, 4)) expect(await s.repo.bookmark(userId, post, s.clock.next())).toBe(true);
    for (const other of others.slice(0, 5)) expect(await s.repo.follow(userId, other.id, moment)).toBe(true);
    for (const other of others.slice(5, 8)) expect(await s.repo.block(userId, other.id, s.clock.next())).toBe(true);
    for (const other of others.slice(0, 3)) expect(await s.repo.mute(userId, other.id, s.clock.next())).toBe(true);

    const now = new Date();
    const paged = await collect(exportJson(await buildExport(deps(), userId, owner.session.sessionId, now, 2)));
    const whole = await collect(exportJson(await buildExport(deps(), userId, owner.session.sessionId, now)));
    expect(paged).toBe(whole);
    expect(paged).toBe(JSON.stringify(JSON.parse(paged), null, 2));
    const json = ExportFormat.parse(JSON.parse(paged));
    expect(json.posts.map((post) => post.id)).toEqual(posts);
    expect(json.likes.map((like) => like.postId)).toEqual([...bobsPosts].sort());
    expect(json.reposts.map((repost) => [repost.postId, repost.at])).toEqual(bobsPosts.slice(0, 3).map((post) => [post, "2026-01-01T00:00:00.123Z"]));
    expect(json.bookmarks.map((bookmark) => bookmark.postId)).toEqual(bobsPosts.slice(0, 4));
    const byId = (list: { id: string; handle: string }[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1)).map((profile) => profile.handle);
    expect(json.following.map((ref) => ref.handle)).toEqual(byId(others.slice(0, 5)));
    expect(json.blocks.map((ref) => ref.handle)).toEqual(others.slice(5, 8).map((profile) => profile.handle));
    expect(json.mutes.map((ref) => ref.handle)).toEqual(others.slice(0, 3).map((profile) => profile.handle));
  });
});
```

### Replace `apps/api/test/integration/account-takedown.test.ts` (whole file)

```ts
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeDb, createDb, profiles, users, type Db } from "@korbat/db";
import type { AccountDeps } from "../../src/account/context";
import { purgePending } from "../../src/account/purge";
import { AuthError } from "../../src/auth/context";
import { confirmDeletion, finishPurge, startDeletion } from "../../src/auth/flows/deletion";
import { signIn } from "../../src/auth/flows/signin";
import { registerOptions, registerVerify, signInOptions, signInVerify } from "../../src/auth/passkeys/flows";
import { createAuthRepo, type AuthRepo } from "../../src/auth/repo";
import { loadConfig } from "../../src/config";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createProfileStore } from "../../src/profiles/store";
import { SoftAuthenticator, type SoftFlags } from "../auth/soft-authenticator";
import { flowHarness, newTestDevice, onboardedUser, type FlowHarness } from "./flow-harness";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { socialHarness, type SocialHarness } from "./social-harness";

const newHandle = () => `t_${randomBytes(5).toString("hex")}`;
const ORIGIN = "http://localhost:8081";
const RP_ID = "localhost";
const ALL: SoftFlags = { up: true, uv: true, be: true, bs: true };

interface StepOneRows {
  live_sessions: number;
  sessions: number;
  devices: number;
  codes: number;
  events: number;
  passkeys: number;
  /** 1 while the account's WebAuthn user handle is set, 0 once the take-down cleared it. */
  user_handles: number;
}

/** The AuthError a flow rejects with; anything else fails the test. */
async function failure(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected the flow to reject");
}

/**
 * Step 1 of an account deletion on real Postgres (1b design, section 7.6): the auth module marks the
 * account deleted, revokes its sessions, deletes its devices and codes and records the event in one
 * transaction, and the purge job's last step (the auth module's finishPurge) does the row side again for
 * an account marked deleted without the rest, as a take-down that stopped after the mark leaves it.
 */
describe.skipIf(!process.env.INTEGRATION)("integration: step 1 of an account deletion", () => {
  let apiDb: Db;
  let authDb: Db;
  let authRepo: AuthRepo;
  let h: FlowHarness;
  let m: MediaHarness;
  let s: SocialHarness;

  beforeAll(async () => {
    const config = loadConfig();
    apiDb = createDb(config.DATABASE_URL_API, { max: 4 });
    authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
    authRepo = createAuthRepo(authDb);
    h = flowHarness(authRepo, { profiles: createProfileStore(apiDb) });
    m = await mediaHarness(apiDb);
    s = socialHarness(apiDb);
  });
  afterAll(async () => {
    m.cleanup();
    await Promise.all([closeDb(apiDb), closeDb(authDb)]);
  });

  /** The account module's dependencies as the server composes them, with the auth side's last step through the auth module's own finishPurge. */
  const deps = (): AccountDeps => ({
    auth: {
      startDeletion: (session, ctx) => startDeletion(h.deps, session, ctx),
      confirmDeletion: (session, input) => confirmDeletion(h.deps, session, input),
      pendingPurges: () => authRepo.pendingPurges(),
      finishPurge: (userId) => finishPurge(h.deps, userId),
      exportAccount: async () => {
        throw new Error("not exercised here");
      },
      appendEvent: (userId, type, metadata) => authRepo.appendEvent({ userId, type, metadata }),
    },
    social: {
      purgeProfile: (userId, now, within) => s.repo.purgeProfile(userId, now, within),
      exportProfile: async () => {
        throw new Error("not exercised here");
      },
    },
    media: {
      purgeOwner: (tx, ownerId) => m.deps.repo.purgeOwner(tx, ownerId),
      requestDeletion: (ids) => m.files.requestDeletion(ids),
      exportImages: async () => [],
    },
    limits: new MemoryStore(),
    log: pino({ level: "silent" }),
    now: () => new Date(),
  });

  /**
   * An account with a profile, signed in on two devices, with a code out for it and a passkey registered from the first
   * device (which also set the account's WebAuthn user handle), besides whatever the test asks for. The authenticator that
   * holds the passkey is answered too, for a sign-in with it later.
   */
  async function account() {
    const owner = await onboardedUser(h, authRepo);
    const handle = newHandle();
    expect((await createProfileStore(apiDb).create({ id: owner.user.id, handle, displayName: "Owner" })).ok).toBe(true);
    const other = await signIn(h.deps, owner.user, newTestDevice(), h.ctx, { alertNewDevice: false, factors: { email: h.clock.ms() }, method: "email" });
    await authRepo.createEmailCode({ flowId: randomBytes(16).toString("hex"), email: owner.email, userId: owner.user.id, purpose: "reauth", codeHash: "h", expiresAt: new Date(Date.now() + 600_000), ipHash: "x" });
    const auth = new SoftAuthenticator();
    const { options } = await registerOptions(h.deps, owner.session, { label: "Owner" });
    const response = auth.create({ rpId: options.rp.id!, challenge: options.challenge, origin: ORIGIN, userHandle: Buffer.from(options.user.id, "base64url"), flags: ALL });
    await registerVerify(h.deps, owner.session, { response });
    return { ...owner, handle, sessionIds: [owner.session.sessionId, other.issued.session.sessionId], auth, credentialId: response.id };
  }

  /** A whole passkey sign-in on the account's first device: fresh options, the authenticator's answer and the verification. */
  async function passkeySignIn(owner: Awaited<ReturnType<typeof account>>) {
    const { options } = await signInOptions(h.deps, h.ctx);
    const response = owner.auth.get({ credentialId: owner.credentialId, rpId: RP_ID, challenge: options.challenge, origin: ORIGIN, flags: ALL, counter: 0 });
    return signInVerify(h.deps, { deviceId: owner.device.deviceId, platform: "web", response }, h.ctx);
  }

  const stepOneRows = async (userId: string): Promise<StepOneRows> =>
    (
      (await authDb.execute(sql`select
        (select count(*)::int from auth.sessions where user_id = ${userId}::uuid and revoked_at is null) as live_sessions,
        (select count(*)::int from auth.sessions where user_id = ${userId}::uuid) as sessions,
        (select count(*)::int from auth.devices where user_id = ${userId}::uuid) as devices,
        (select count(*)::int from auth.email_codes where user_id = ${userId}::uuid) as codes,
        (select count(*)::int from auth.auth_events where user_id = ${userId}::uuid and type = 'account_deleted') as events,
        (select count(*)::int from auth.passkeys where user_id = ${userId}::uuid) as passkeys,
        (select count(*)::int from auth.users where id = ${userId}::uuid and webauthn_user_id is not null) as user_handles`)) as unknown as StepOneRows[]
    )[0]!;
  const authRow = async (id: string) => (await authDb.select().from(users).where(eq(users.id, id)))[0]!;

  test("one confirmation takes every row of step 1 down: the mark, the sessions with their tombstones, the devices, the codes, the passkeys with the WebAuthn user handle, and the event", { timeout: 30_000 }, async () => {
    const owner = await account();
    const { flowId } = await startDeletion(h.deps, owner.session, h.ctx);
    const code = h.mailer.lastCodeFor(owner.email)!;
    expect(await stepOneRows(owner.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 2, events: 0, passkeys: 1, user_handles: 1 });

    await confirmDeletion(h.deps, owner.session, { flowId, code, handle: owner.handle });

    expect(await stepOneRows(owner.user.id)).toEqual({ live_sessions: 0, sessions: 0, devices: 0, codes: 0, events: 1, passkeys: 0, user_handles: 0 });
    const row = await authRow(owner.user.id);
    expect(row.deletedAt).not.toBeNull();
    // Only step 1 ran: the purge anonymises the row later.
    expect([row.email, row.purgedAt]).toEqual([owner.email, null]);
    for (const id of owner.sessionIds) expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
    expect(await authRepo.pendingPurges()).toContain(owner.user.id);
  });

  test("the take-down is one transaction: when its last statement fails, the mark and every row are still as they were", { timeout: 30_000 }, async () => {
    const owner = await account();
    // The event's device column is a uuid, so this device id makes the transaction's last statement fail.
    await expect(authRepo.takeDown(owner.user.id, new Date(), "not-a-uuid")).rejects.toThrow();
    // The passkey and the user handle are written before the event: both are back, so they went in the same transaction.
    expect(await stepOneRows(owner.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 1, events: 0, passkeys: 1, user_handles: 1 });
    expect((await authRow(owner.user.id)).deletedAt).toBeNull();
    expect(await authRepo.findUserById(owner.user.id)).toBeDefined();
    expect(await authRepo.findActiveSession(owner.session.sessionId, new Date())).toBeDefined();
  });

  test("one round of the purge job fully takes down an account marked deleted by hand with its sessions, devices, codes and passkey still there", { timeout: 30_000 }, async () => {
    const ghost = await account();
    const alive = await account();
    await authRepo.markDeleted(ghost.user.id, new Date(Date.now() - 60_000));
    expect(await stepOneRows(ghost.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 1, events: 0, passkeys: 1, user_handles: 1 });

    const report = await purgePending(deps());
    expect(report.failed).toBe(0);
    expect(report.purged).toBeGreaterThanOrEqual(1);

    expect(await stepOneRows(ghost.user.id)).toEqual({ live_sessions: 0, sessions: 0, devices: 0, codes: 0, events: 0, passkeys: 0, user_handles: 0 });
    for (const id of ghost.sessionIds) expect(await h.kv.get(`sess:${id}`), id).toBe("revoked");
    expect(await authRow(ghost.user.id)).toMatchObject({ email: `deleted:${ghost.user.id}`, emailVerifiedAt: null, termsVersion: null });
    expect((await authRow(ghost.user.id)).purgedAt).not.toBeNull();
    expect((await apiDb.select().from(profiles).where(eq(profiles.id, ghost.user.id)))[0]).toMatchObject({ displayName: "Deleted account", handle: ghost.handle });
    expect(await authRepo.pendingPurges()).not.toContain(ghost.user.id);

    // A live account is not the job's business: its rows stay as they were.
    expect(await stepOneRows(alive.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 1, events: 0, passkeys: 1, user_handles: 1 });
    expect(await authRepo.findActiveSession(alive.session.sessionId, new Date())).toBeDefined();
    // The last step on its own, again or for a live account, changes nothing.
    const purged = await authRow(ghost.user.id);
    await finishPurge(h.deps, ghost.user.id);
    await finishPurge(h.deps, alive.user.id);
    expect(await authRow(ghost.user.id)).toEqual(purged);
    expect(await stepOneRows(alive.user.id)).toEqual({ live_sessions: 2, sessions: 2, devices: 2, codes: 1, events: 0, passkeys: 1, user_handles: 1 });
    expect(await authRow(alive.user.id)).toMatchObject({ email: alive.email, deletedAt: null, purgedAt: null });
  });

  test("a deleted account's passkey signs nobody in: passkey_invalid after the take-down, and still after the purge", { timeout: 30_000 }, async () => {
    const owner = await account();
    // While the account lives, the passkey signs in on the device that registered it.
    expect((await passkeySignIn(owner)).kind).toBe("session");

    const { flowId } = await startDeletion(h.deps, owner.session, h.ctx);
    await confirmDeletion(h.deps, owner.session, { flowId, code: h.mailer.lastCodeFor(owner.email)!, handle: owner.handle });
    // The passkey row went with the take-down and the handle with it, so the credential is one korbat has never seen, whatever the assertion says.
    expect(await stepOneRows(owner.user.id)).toMatchObject({ passkeys: 0, user_handles: 0 });
    expect(await failure(passkeySignIn(owner))).toMatchObject({ code: "passkey_invalid", status: 401 });

    await finishPurge(h.deps, owner.user.id);
    expect((await authRow(owner.user.id)).purgedAt).not.toBeNull();
    expect(await stepOneRows(owner.user.id)).toMatchObject({ passkeys: 0, user_handles: 0 });
    expect(await failure(passkeySignIn(owner))).toMatchObject({ code: "passkey_invalid", status: 401 });
  });
});
```

### Replace `packages/contracts/test/account.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import { ExportFormat } from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-24T10:00:00.000Z";

/** A complete export of a small account: every list holds one entry so each entry shape is exercised. */
const full = {
  format: "korbat-export-1",
  exportedAt: at,
  account: {
    id: id(1),
    email: "ada@example.com",
    createdAt: at,
    role: "user",
    mfaEnabled: true,
    hasPassword: true,
    verified: false,
    termsVersion: "draft-2026-09",
    termsAcceptedAt: at,
    passkeys: [
      { name: "Laptop", createdAt: at, lastUsedAt: at, synced: true, createdOn: "Chrome on Windows" },
      { name: "Security key", createdAt: at, lastUsedAt: null, synced: false, createdOn: null },
    ],
  },
  profile: { handle: "ada", displayName: "Ada", bio: "hello", createdAt: at, handleHistory: ["ada_l", "ada"] },
  posts: [
    { id: id(2), body: "first", createdAt: at, replyToId: null, quoteOfId: null, state: "visible", deletedAt: null, media: [{ id: id(3), file: `media/${id(3)}.webp`, altText: "a cat", width: 2048, height: 1536 }] },
    { id: id(4), body: "", createdAt: at, replyToId: id(2), quoteOfId: null, state: "deleted_by_author", deletedAt: at, media: [] },
  ],
  likes: [{ postId: id(5), at }],
  reposts: [{ postId: id(5), at }],
  bookmarks: [{ postId: id(5), at }],
  following: [{ handle: "grace", since: at }],
  blocks: [{ handle: "troll", since: at }],
  mutes: [{ handle: "loud", since: at }],
  sessions: [{ id: "a".repeat(64), createdAt: at, lastUsedAt: at, current: true }],
  devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: at, lastSeenAt: at }],
  events: [{ type: "signup", at }],
  missingMedia: [id(6)],
};

describe("export format", () => {
  test("a complete export parses unchanged, and every list may be empty", () => {
    expect(ExportFormat.parse(full)).toEqual(full);
    const empty = { ...full, account: { ...full.account, passkeys: [] }, posts: [], likes: [], reposts: [], bookmarks: [], following: [], blocks: [], mutes: [], sessions: [], devices: [], events: [], missingMedia: [] };
    expect(ExportFormat.parse(empty)).toEqual(empty);
  });

  test("the format name is fixed, so a reader can tell what it opened", () => {
    expect(ExportFormat.safeParse({ ...full, format: "korbat-export-2" }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, format: undefined }).success).toBe(false);
  });

  test("the account and the profile carry the nullable facts as null, never missing", () => {
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, termsVersion: null, termsAcceptedAt: null } }).success).toBe(true);
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, email: "not-an-email" } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, account: { ...full.account, role: "owner" } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, handleHistory: undefined } }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, profile: { ...full.profile, handleHistory: [1] } }).success).toBe(false);
  });

  test("the account's passkeys carry a name, their times, whether they are synced and where they were added, and nothing that identifies the key", () => {
    const [laptop] = full.account.passkeys;
    const withPasskeys = (passkeys: unknown) => ExportFormat.safeParse({ ...full, account: { ...full.account, passkeys } }).success;
    // The list is part of the format since 1c: always present, empty for an account without passkeys.
    expect(withPasskeys(undefined)).toBe(false);
    expect(withPasskeys([])).toBe(true);
    expect(withPasskeys([{ ...laptop, lastUsedAt: null, createdOn: null }])).toBe(true);
    expect(withPasskeys([{ ...laptop, lastUsedAt: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, createdOn: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, name: undefined }])).toBe(false);
    expect(withPasskeys([{ ...laptop, createdAt: "last week" }])).toBe(false);
    expect(withPasskeys([{ ...laptop, synced: "yes" }])).toBe(false);
    // A reader gets the five fields and no more: nothing of the key, its id or its authenticator is part of the format.
    const parsed = ExportFormat.parse({ ...full, account: { ...full.account, passkeys: [{ ...laptop, id: id(7), credentialId: "Y3JlZA", publicKey: "cose", aaguid: id(8) }] } });
    expect(parsed.account.passkeys).toEqual([laptop]);
  });

  test("a deleted post keeps its place with an empty body and a deletion time; an attached image has its dimensions", () => {
    const [post] = full.posts;
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, state: "hidden" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, replyToId: undefined }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, media: [{ id: id(3), file: "media/x.webp", altText: "a cat" }] }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, posts: [{ ...post, media: undefined }] }).success).toBe(false);
  });

  test("engagement entries name a post and a time, graph entries a handle and a time", () => {
    expect(ExportFormat.safeParse({ ...full, likes: [{ postId: "nope", at }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, bookmarks: [{ postId: id(5) }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, following: [{ handle: "grace" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, mutes: [{ handle: "loud", since: "last week" }] }).success).toBe(false);
  });

  test("sessions, devices, events and missing media keep their shapes", () => {
    expect(ExportFormat.safeParse({ ...full, sessions: [{ id: "a".repeat(64), createdAt: at, lastUsedAt: at }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, devices: [{ ...full.devices[0], label: null }] }).success).toBe(true);
    expect(ExportFormat.safeParse({ ...full, devices: [{ ...full.devices[0], platform: "desktop" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, events: [{ type: "signup" }] }).success).toBe(false);
    expect(ExportFormat.safeParse({ ...full, missingMedia: undefined }).success).toBe(false);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
❯ test/account/export.test.ts (23 tests | 6 failed) 7707ms
Test Files  1 failed | 42 passed | 38 skipped (81)
Tests  6 failed | 408 passed | 240 skipped (654)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/06-deletion-export.md 3
```

Expected: 6 lines starting with `wrote`, one for each file below.

### Replace `apps/api/src/account/flows/export.ts` (whole file)

```ts
import type { Logger } from "pino";
import type { Platform } from "@korbat/contracts";
import type { AccountExport } from "../../auth";
import type { ProfileExport } from "../../social";
import { AccountError, type AccountDeps } from "../context";
import type { OpenFile, ZipWriter } from "../zip";

/** One export a day (1b design, section 10). */
export const EXPORTS_PER_WINDOW = 1;
export const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

const exportLimitKey = (userId: string) => `export:${userId}`;

/** The entry an image has in the archive; export.json names it under the post's media. */
export function mediaEntry(id: string): string {
  return `media/${id}.webp`;
}

/** The download's name: the handle and the day, so several exports of one account sort by date. */
export function exportFilename(handle: string, now: Date): string {
  return `korbat-export-${handle}-${now.toISOString().slice(0, 10)}.zip`;
}

/**
 * What the archive is written from. The account's own facts and the profile are read before the first
 * byte; the profile's lists are read page by page while export.json is written, and the images, each
 * behind the media module's checked open, go first, so `missingMedia` is complete by the time the JSON
 * that lists it is written.
 */
export interface ExportPlan {
  exportedAt: Date;
  currentSessionId: string;
  account: AccountExport;
  profile: ProfileExport;
  images: { id: string; open: OpenFile }[];
  /** The images whose file the checked open refused or could not find, filled while the images are written. */
  missingMedia: string[];
}

/**
 * Counts one export of the account in the daily window and refuses once it is used up. Taken before
 * anything is built or streamed, so a stream that fails midway still counts; Retry-After says when the
 * window resets.
 */
export async function enforceExportLimit(deps: AccountDeps, userId: string): Promise<void> {
  let hit: { count: number; resetMs: number };
  try {
    hit = await deps.limits.hit(exportLimitKey(userId), EXPORT_WINDOW_MS);
  } catch {
    // Fails closed: an export that cannot be counted is not made, and the client is told to retry shortly.
    throw new AccountError("service_unavailable", 503, undefined, 30);
  }
  if (hit.count > EXPORTS_PER_WINDOW) throw new AccountError("rate_limited", 429, undefined, Math.max(1, Math.ceil(hit.resetMs / 1000)));
}

/**
 * Gives the day's export back after a failure before the archive's first byte (a pool timeout, a
 * restart): the owner received nothing, so the attempt must not use up the day. Best effort: when the
 * store cannot be reached, the export stays counted and a warning says so, which costs the owner a day
 * at worst.
 */
export async function giveBackExport(deps: AccountDeps, userId: string, log: Logger): Promise<void> {
  try {
    await deps.limits.release(exportLimitKey(userId));
  } catch (err) {
    log.warn({ err, userId }, "account export: the day's export could not be given back after a failure before the first byte");
  }
}

const iso = (at: Date): string => at.toISOString();
const isoOrNull = (at: Date | null): string | null => (at ? at.toISOString() : null);

/**
 * Reads what is needed before the first byte: the account's facts, sessions, devices and events (one
 * read, bounded by the 90 days of events), the profile's own fields, and the list of images. The three
 * modules are asked at once. `pageSize` is how many rows of each profile list are read at a time; tests
 * lower it.
 */
export async function buildExport(deps: AccountDeps, userId: string, currentSessionId: string, now: Date, pageSize?: number): Promise<ExportPlan> {
  const [account, profile, images] = await Promise.all([deps.auth.exportAccount(userId), deps.social.exportProfile(userId, pageSize), deps.media.exportImages(userId)]);
  return { exportedAt: now, currentSessionId, account, profile, images, missingMedia: [] };
}

/** A list member of export.json, read in pages and written one element at a time. */
class Paged<T> {
  constructor(
    readonly pages: AsyncIterable<readonly T[]>,
    readonly element: (row: T) => unknown,
  ) {}
}

/** An array already in memory, as one page. */
function inMemory<T>(rows: readonly T[], element: (row: T) => unknown): Paged<T> {
  return new Paged(
    (async function* () {
      yield rows;
    })(),
    element,
  );
}

/** Fragments are gathered into pieces of about this many UTF-16 units, at most 3 bytes each in UTF-8: well under 64 KiB. */
const PIECE_CHARS = 16 * 1024;

/**
 * export.json in pieces, written exactly as JSON.stringify(document, null, 2) writes the whole
 * document: member by member at the top level, and the lists element by element, each element
 * stringified on its own and indented to its depth (JSON.stringify's output holds line breaks only
 * between tokens; one inside a string is escaped, so indenting after every line break is exact). No list
 * is ever whole in memory: each is read page by page as it is written.
 */
export async function* exportJson(plan: ExportPlan): AsyncGenerator<string> {
  let buffer = "";
  for await (const fragment of documentFragments(plan)) {
    buffer += fragment;
    if (buffer.length >= PIECE_CHARS) {
      yield buffer;
      buffer = "";
    }
  }
  if (buffer.length > 0) yield buffer;
}

async function* documentFragments(plan: ExportPlan): AsyncGenerator<string> {
  const { account, profile } = plan;
  const ref = (row: { postId: string; at: Date }) => ({ postId: row.postId, at: iso(row.at) });
  const other = (row: { handle: string; since: Date }) => ({ handle: row.handle, since: iso(row.since) });
  // The members in the order of the format (ExportFormat in the contracts); the order is part of the bytes.
  const members: [string, unknown][] = [
    ["format", "korbat-export-1"],
    ["exportedAt", iso(plan.exportedAt)],
    [
      "account",
      {
        id: account.account.id,
        email: account.account.email,
        createdAt: iso(account.account.createdAt),
        role: account.account.role,
        mfaEnabled: account.account.mfaEnabled,
        hasPassword: account.account.hasPassword,
        verified: account.account.verified,
        termsVersion: account.account.termsVersion,
        termsAcceptedAt: isoOrNull(account.account.termsAcceptedAt),
        // Inside the account, where the format places them; at most the cap of ten, so they are written with the account's other facts rather than paged.
        passkeys: account.passkeys.map((passkey) => ({ name: passkey.name, createdAt: iso(passkey.createdAt), lastUsedAt: isoOrNull(passkey.lastUsedAt), synced: passkey.synced, createdOn: passkey.createdOn })),
      },
    ],
    [
      "profile",
      {
        handle: profile.profile.handle,
        displayName: profile.profile.displayName,
        bio: profile.profile.bio,
        createdAt: iso(profile.profile.createdAt),
        handleHistory: [...profile.profile.handleHistory],
      },
    ],
    [
      "posts",
      new Paged(profile.posts, (post) => ({
        id: post.id,
        body: post.body,
        createdAt: iso(post.createdAt),
        replyToId: post.replyToId,
        quoteOfId: post.quoteOfId,
        state: post.state,
        deletedAt: isoOrNull(post.deletedAt),
        media: post.media.map((image) => ({ id: image.id, file: mediaEntry(image.id), altText: image.altText, width: image.width, height: image.height })),
      })),
    ],
    ["likes", new Paged(profile.likes, ref)],
    ["reposts", new Paged(profile.reposts, ref)],
    ["bookmarks", new Paged(profile.bookmarks, ref)],
    ["following", new Paged(profile.following, other)],
    ["blocks", new Paged(profile.blocks, other)],
    ["mutes", new Paged(profile.mutes, other)],
    [
      "sessions",
      inMemory(account.sessions, (session) => ({ id: session.id, createdAt: iso(session.createdAt), lastUsedAt: iso(session.lastUsedAt), current: session.id === plan.currentSessionId })),
    ],
    [
      "devices",
      // The platform column is text; sign-in only ever writes one of the contract's three values.
      inMemory(account.devices, (device) => ({ label: device.label, platform: device.platform as Platform, firstSeenAt: iso(device.firstSeenAt), lastSeenAt: iso(device.lastSeenAt) })),
    ],
    ["events", inMemory(account.events, (event) => ({ type: event.type, at: iso(event.at) }))],
    // Complete by now: the images were written before the JSON.
    ["missingMedia", inMemory(plan.missingMedia, (id) => id)],
  ];

  yield "{\n";
  for (const [index, [key, value]] of members.entries()) {
    yield `${index === 0 ? "" : ",\n"}  ${JSON.stringify(key)}: `;
    if (value instanceof Paged) yield* listFragments(value);
    else yield indented(JSON.stringify(value, null, 2), "  ");
  }
  yield "\n}";
}

/** A top-level member's array, as JSON.stringify writes it at that depth: "[]" when empty, else one element per line group. */
async function* listFragments<T>(list: Paged<T>): AsyncGenerator<string> {
  let first = true;
  for await (const page of list.pages) {
    for (const row of page) {
      yield `${first ? "[\n" : ",\n"}    ${indented(JSON.stringify(list.element(row), null, 2), "    ")}`;
      first = false;
    }
  }
  yield first ? "[]" : "\n  ]";
}

const indented = (json: string, pad: string): string => json.replaceAll("\n", `\n${pad}`);

/**
 * Writes the archive: every image as a stored entry, then export.json, then the central directory.
 * export.json comes last so that missingMedia can name every image whose file the checked open refused
 * or did not find when its turn came (the sweeper may be between the row and the file); the order of
 * entries means nothing to a reader.
 */
export async function writeExport(writer: ZipWriter, plan: ExportPlan): Promise<void> {
  for (const image of plan.images) {
    if (!(await writer.addFile(mediaEntry(image.id), image.open))) plan.missingMedia.push(image.id);
  }
  await writer.addJsonPieces("export.json", exportJson(plan));
  await writer.end();
}
```

### Replace `apps/api/src/auth/flows/deletion.ts` (whole file)

```ts
import type { DeleteConfirmRequest, DeleteStartResponse } from "@korbat/contracts";
import { AuthError, type AuthDeps, type RequestContext } from "../context";
import { randomToken } from "../crypto";
import { HOUR, enforceLimit } from "../limits";
import type { Session } from "../sessions";
import { CODE_TTL_MS, checkEmailCode, emailCodeHash, flowKey, newEmailCode, sendCode } from "./email";
import { notifyAccount } from "./notify";

export const DELETE_STARTS_PER_HOUR = 3;

/** The deletion a code is out for: kept under the hashed flow id until the code is entered or expires. */
export interface PendingDeletion {
  userId: string;
}

/**
 * Mails the deletion code to the account's own address (1b design, section 7.6): the second of the
 * three guards, after the fresh session the route demands and before the handle the owner types. The
 * code row carries the owner, so no other account can spend it.
 */
export async function startDeletion(deps: AuthDeps, session: Session, ctx: RequestContext): Promise<DeleteStartResponse> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  await enforceLimit(deps.kv, `delete-start:${user.id}`, DELETE_STARTS_PER_HOUR, HOUR);
  const flowId = randomToken();
  const code = newEmailCode();
  await deps.repo.createEmailCode({
    flowId,
    email: user.email,
    userId: user.id,
    purpose: "delete_account",
    codeHash: emailCodeHash(deps.config.authHmacKey, flowId, code),
    expiresAt: new Date(deps.now().getTime() + CODE_TTL_MS),
    ipHash: ctx.ipHash,
  });
  const pending: PendingDeletion = { userId: user.id };
  await deps.kv.set(flowKey(flowId), JSON.stringify(pending), CODE_TTL_MS);
  await sendCode(deps, { to: user.email, template: "delete_account_code", data: { code } });
  return { flowId };
}

/**
 * Writes the cache tombstones of sessions the database has just revoked, so a cached copy cannot serve
 * them for the rest of its minute. Best effort: the rows are revoked whatever happens here, so a failure
 * only lets a cached copy live out that minute, and the account is not left half gone because the cache
 * was unreachable.
 */
async function tombstoneQuietly(deps: AuthDeps, userId: string, sessionIds: readonly string[]): Promise<void> {
  try {
    await deps.sessions.tombstone(sessionIds);
  } catch (err) {
    deps.log.error({ err, userId }, "account deletion: the session tombstones could not be written; the sessions are revoked in the database");
  }
}

/**
 * The auth side of a deletion, step 1 of section 7.6: the typed handle must be the account's own,
 * then the code must be right; then, in one transaction, the account is marked deleted (every lookup
 * treats the row as absent from here, so no request can succeed against it while the purge runs),
 * every session revoked, its devices, codes and passkeys deleted, its WebAuthn user handle cleared and
 * the event recorded; then the revoked sessions get their tombstones, so the cache cannot revive one,
 * and the account is told. Nothing after the transaction can fail the request: the account is gone
 * once it commits. The row itself is anonymised by finishPurge, once the account module has purged the
 * other schemas.
 */
export async function confirmDeletion(deps: AuthDeps, session: Session, input: DeleteConfirmRequest): Promise<void> {
  const user = await deps.repo.findUserById(session.userId);
  if (!user) throw new AuthError("invalid_credentials", 401);
  // The handle is the third guard, compared in any case and checked before the code, so a slip of the fingers costs no attempt on it.
  const profile = await deps.profiles.find(user.id);
  if (!profile || profile.handle.toLowerCase() !== input.handle.toLowerCase()) throw new AuthError("invalid_request", 400, "handle_mismatch");
  const row = await deps.repo.findEmailCode(input.flowId);
  // A code from another account's deletion, or from any other flow, is no code at all, settled before an attempt is counted.
  if (row?.purpose !== "delete_account" || row.userId !== user.id) throw new AuthError("invalid_code", 400);
  await checkEmailCode(deps, row, input.flowId, input.code);
  // Taken, not read: whatever happens next, this flow is over and the code is spent.
  if (!(await deps.kv.take(flowKey(input.flowId)))) throw new AuthError("code_expired", 400);

  const revoked = await deps.repo.takeDown(user.id, deps.now(), session.deviceId);
  await tombstoneQuietly(deps, user.id, revoked);
  // Told once the account is gone, and never before: a take-down that failed leaves the account as it was. The address
  // still belongs to the row until finishPurge; best effort, since no mail failure may keep an account its owner has given up.
  await notifyAccount(deps, user.email, "account_deleted");
}

/**
 * Step 4 of section 7.6, which the purge job runs for every account left half deleted: the rows of
 * step 1 again (sessions still live revoked with their tombstones, devices, codes and passkeys deleted,
 * the WebAuthn user handle cleared), for an account marked deleted without the rest, then the row
 * anonymised and marked purged. Both parts change nothing for an account that is live or already
 * purged, so the job can repeat it after any failure.
 */
export async function finishPurge(deps: AuthDeps, userId: string): Promise<void> {
  const revoked = await deps.repo.finishTakeDown(userId, deps.now());
  await tombstoneQuietly(deps, userId, revoked);
  await deps.repo.finishPurge(userId, deps.now());
}
```

### Replace `apps/api/src/auth/flows/export.ts` (whole file)

```ts
import { AuthError, type AuthDeps } from "../context";
import { EVENT_RETENTION_DAYS } from "../janitor";
import { HOUR } from "../limits";
import type { AuthEventType, UserRole } from "../repo";

const DAY = 24 * HOUR;

/**
 * The auth module's part of the data export (1b design, section 7.5): the account row's facts, its
 * passkeys, its live sessions, its devices and its own security events. Times are Dates here; the
 * account module writes them as ISO text.
 */
export interface AccountExport {
  account: {
    id: string;
    email: string;
    createdAt: Date;
    role: UserRole;
    mfaEnabled: boolean;
    hasPassword: boolean;
    /** The verified badge as this row records it: the phone hash is held exactly while the badge is. */
    verified: boolean;
    termsVersion: string | null;
    termsAcceptedAt: Date | null;
  };
  /**
   * The account's passkeys, newest first, as the Security list shows them (1c design, section 7.7): the key
   * material, the credential id, the AAGUID and the row's id stay behind, since none of them is the owner's to
   * carry and any of them would name the key to whoever reads the archive.
   */
  passkeys: { name: string; createdAt: Date; lastUsedAt: Date | null; synced: boolean; createdOn: string | null }[];
  /** Live sessions only, most recently used first. The caller marks the current one. */
  sessions: { id: string; createdAt: Date; lastUsedAt: Date }[];
  devices: { label: string | null; platform: string; firstSeenAt: Date; lastSeenAt: Date }[];
  /** The account's own events, newest first, at most the 90 days the janitor keeps; the metadata stays behind. */
  events: { type: AuthEventType; at: Date }[];
}

export async function exportAccount(deps: AuthDeps, userId: string): Promise<AccountExport> {
  const user = await deps.repo.findUserById(userId);
  // A session whose account is gone is answered as /me answers it.
  if (!user) throw new AuthError("invalid_credentials", 401);
  const now = deps.now();
  const [passkeys, sessions, devices, events] = await Promise.all([
    deps.repo.listPasskeys(userId),
    deps.repo.listActiveSessions(userId, now),
    deps.repo.listDevices(userId),
    deps.repo.eventsSince(userId, new Date(now.getTime() - EVENT_RETENTION_DAYS * DAY)),
  ]);
  return {
    account: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      role: user.role,
      mfaEnabled: user.totpEnabledAt !== null,
      hasPassword: user.passwordHash !== null,
      verified: user.phoneHash !== null,
      termsVersion: user.termsVersion,
      termsAcceptedAt: user.termsAcceptedAt,
    },
    // The backed-up flag is what the Security list calls synced; the list is already newest first.
    passkeys: passkeys.map((passkey) => ({ name: passkey.name, createdAt: passkey.createdAt, lastUsedAt: passkey.lastUsedAt, synced: passkey.backedUp, createdOn: passkey.createdOn })),
    sessions: sessions.map((session) => ({ id: session.id, createdAt: session.createdAt, lastUsedAt: session.lastUsedAt })),
    devices: devices.map((device) => ({ label: device.label, platform: device.platform, firstSeenAt: device.firstSeenAt, lastSeenAt: device.lastSeenAt })),
    events: events.map((event) => ({ type: event.type, at: event.createdAt })),
  };
}
```

### Replace `apps/api/src/auth/index.ts` (whole file)

```ts
/**
 * The only file outside `src/auth/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { DeleteConfirmRequest, DeleteStartResponse } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type Redis from "ioredis";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { Mailer } from "../mail/mailer";
import { clientIdentity } from "./client-ip";
import { authConfigFrom, type AuthDeps, type ProfileStore, type RequestContext } from "./context";
import { confirmDeletion, finishPurge, startDeletion } from "./flows/deletion";
import { exportAccount, type AccountExport } from "./flows/export";
import { redisKv, type KeyValueStore } from "./kv";
import { createLockout } from "./lockout";
import { requireFreshAuth, requireOnboarding, requireSession, requireStaffMfa, requireStrongFreshAuth, resolveSession } from "./middleware";
import type { JobLock } from "../lib/jobs";
import { createJanitor } from "./janitor";
import { hibpChecker, type BreachChecker } from "./passwords";
import { createAuthRepo, type AuthEventType } from "./repo";
import { authRoutes, meHandler } from "./routes";
import { createSessions, type Session } from "./sessions";
import { cloudflareTurnstile, type TurnstileVerifier } from "./turnstile";
import { devProvider } from "./verify/dev";
import type { VerificationProvider } from "./verify/provider";
import { vonageProvider } from "./verify/vonage";

export type { ProfileStore, RequestContext } from "./context";
export type { AccountExport } from "./flows/export";
export type { AuthEventType, UserRole } from "./repo";
export type { ProxyTrust } from "./client-ip";
export type { Session } from "./sessions";
export type { VerificationProvider } from "./verify/provider";
export { AuthError, isUniqueViolation } from "./context";
export { grantRole } from "./admin";
/** The account module clears a web session's cookies after a deletion; the cookie names and attributes stay this module's. */
export { clearSessionCookies } from "./cookies";
export { checkHandle } from "./handles";
export { redisKv, type KeyValueStore } from "./kv";
export { createAuthRepo } from "./repo";
export { createSessions } from "./sessions";

/**
 * What the account module needs from this one (1b design, section 5): the auth side of a deletion
 * (the code, the confirmation that takes the account down, the purge's list and its last step), the
 * auth side of the data export, and the event log for what the account module does.
 */
export interface AuthForAccount {
  /** Mails the deletion code to the account's own address and answers the flow id. */
  startDeletion(session: Session, ctx: RequestContext): Promise<DeleteStartResponse>;
  /** Checks the typed handle and the code, then marks the account deleted and revokes every session, in one transaction: from here the account is gone. */
  confirmDeletion(session: Session, input: DeleteConfirmRequest): Promise<void>;
  /** Deleted accounts whose auth row is not anonymised yet, oldest deletion first. */
  pendingPurges(): Promise<string[]>;
  /** Finishes step 1's rows if a take-down stopped after the mark, then anonymises the auth row and marks it purged; a no-op when it already is. */
  finishPurge(userId: string): Promise<void>;
  /** The account's facts, its passkeys (without their keys), its live sessions, its devices and its own events. */
  exportAccount(userId: string): Promise<AccountExport>;
  appendEvent(userId: string, type: AuthEventType, metadata?: Record<string, unknown>): Promise<void>;
}

export interface CreateAuthOptions {
  config: Config;
  logger: Logger;
  /** The korbat_auth pool. The auth module never receives the API pool. */
  authDb: Db;
  mailer: Mailer;
  profiles: ProfileStore;
  /** Either a Redis client or a ready key-value store (tests use an in-memory store). */
  redis?: Redis;
  kv?: KeyValueStore;
  turnstile?: TurnstileVerifier;
  breachChecker?: BreachChecker;
  /**
   * The phone verification provider behind the verified badge. Absent or null, the badge routes answer
   * badge_unavailable; the server passes verificationProviderFrom(config), tests the development provider.
   */
  verify?: VerificationProvider | null;
  now?: () => Date;
}

/**
 * The provider VERIFY_PROVIDER names: none for `off` (the badge is hidden), the fixed-code one for `dev`,
 * Vonage Verify with the configured credentials and brand for `vonage`. `fetchFn` is for tests only.
 */
export function verificationProviderFrom(config: Config, fetchFn?: typeof fetch): VerificationProvider | null {
  switch (config.VERIFY_PROVIDER) {
    case "off":
      return null;
    case "dev":
      return devProvider();
    case "vonage":
      // Production refuses this configuration in config.ts; development gets the same refusal here, at start-up, rather than a failing first request.
      if (!config.VONAGE_API_KEY || !config.VONAGE_API_SECRET) throw new Error("VERIFY_PROVIDER=vonage needs VONAGE_API_KEY and VONAGE_API_SECRET");
      return vonageProvider({ apiKey: config.VONAGE_API_KEY, apiSecret: config.VONAGE_API_SECRET, brand: config.VERIFY_BRAND, fetch: fetchFn });
  }
}

export function createAuth(options: CreateAuthOptions) {
  const kv = options.kv ?? (options.redis ? redisKv(options.redis) : undefined);
  if (!kv) throw new Error("createAuth needs a Redis client or a key-value store");
  const now = options.now ?? (() => new Date());
  const repo = createAuthRepo(options.authDb);
  const sessions = createSessions({ repo, kv, now });
  const deps: AuthDeps = {
    repo,
    kv,
    sessions,
    lockout: createLockout({ repo, kv, now }),
    mailer: options.mailer,
    turnstile: options.turnstile ?? cloudflareTurnstile(options.config.TURNSTILE_SECRET_KEY),
    breachChecker: options.breachChecker ?? hibpChecker(),
    profiles: options.profiles,
    verify: options.verify ?? null,
    config: authConfigFrom(options.config),
    log: options.logger,
    now,
  };
  /** A security event about an account, for the modules that own no auth table (the social module's profile and handle changes, the account module's export). */
  const appendEvent = (userId: string, type: AuthEventType, metadata?: Record<string, unknown>) => repo.appendEvent({ userId, type, metadata });
  const forAccount: AuthForAccount = {
    startDeletion: (session, ctx) => startDeletion(deps, session, ctx),
    confirmDeletion: (session, input) => confirmDeletion(deps, session, input),
    pendingPurges: () => repo.pendingPurges(),
    finishPurge: (userId) => finishPurge(deps, userId),
    exportAccount: (userId) => exportAccount(deps, userId),
    appendEvent,
  };
  return {
    deps,
    routes: authRoutes(deps),
    me: meHandler(deps),
    appendEvent,
    /** The interface the account module uses. */
    forAccount,
    /** Runs first on every request: resolves the client address the way TRUST_PROXY says and hashes it. */
    clientIdentity: clientIdentity({ trust: deps.config.trustProxy, ipHashKey: deps.config.ipHashKey }),
    resolveSession: resolveSession(deps),
    requireSession,
    requireOnboarding,
    requireFreshAuth: (maxAgeSeconds?: number) => requireFreshAuth(deps, maxAgeSeconds),
    /** Level 2 within the window on an account with TOTP, level 1 otherwise: for the routes of the 1c design's section 10. */
    requireStrongFreshAuth: (maxAgeSeconds?: number) => requireStrongFreshAuth(deps, maxAgeSeconds),
    requireStaffMfa,
    /** Starts the retention pass (dead codes, old sessions, device address hashes, old events) and returns the function that stops it. */
    startJanitor: (lock: JobLock) => createJanitor(deps, lock).start(),
  };
}

export type Auth = ReturnType<typeof createAuth>;
```

### Replace `apps/api/src/auth/repo.ts` (whole file)

```ts
import { and, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { authEventType, authEvents, devices, emailCodePurpose, emailCodes, passkeys, sessions, userRole, users, type Db } from "@korbat/db";

/**
 * Every SQL statement the auth module runs. It receives only the korbat_auth pool and touches only
 * tables in the `auth` schema. Single-use and replay rules are enforced with conditional updates so
 * two concurrent requests cannot both succeed.
 */

export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type EmailCodeRow = typeof emailCodes.$inferSelect;
export type AuthEventType = (typeof authEventType.enumValues)[number];
export type EmailCodePurpose = (typeof emailCodePurpose.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
export type PasskeyRow = typeof passkeys.$inferSelect;
/** A passkey with the label of the device that added it, null once that device is gone. */
export type PasskeyListRow = PasskeyRow & { createdOn: string | null };
/** What a registration stores of a verified passkey; the id, the last use and the suspicion are the row's own. */
export type NewPasskey = Omit<PasskeyRow, "id" | "lastUsedAt" | "suspectAt">;

/** The per-account bounds a registration checks in its transaction (1c design, section 2): at most `passkeys` at a time, and `additions` within `windowMs`. */
export interface PasskeyLimits {
  passkeys: number;
  additions: number;
  windowMs: number;
}

/** What addPasskey answers: the row it inserted; which bound refused it, with the seconds until the day has a slot again; or that the account is gone. */
export type AddPasskeyOutcome =
  | { ok: true; passkey: PasskeyRow }
  | { ok: false; reason: "gone" }
  | { ok: false; reason: "cap" }
  | { ok: false; reason: "daily"; retryAfterSeconds: number };

export interface ActiveSessionRow {
  id: string;
  userId: string;
  deviceId: string;
  role: UserRole;
  onboardedAt: Date | null;
  totpEnabledAt: Date | null;
  reauthAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  /** The session's id for life, which a rotation keeps. */
  handle: string;
  /** The factors proven, kind to epoch milliseconds; empty for a session from before migration 0010. */
  factors: Record<string, number>;
  passkeyId: string | null;
}

export interface SessionListRow {
  id: string;
  deviceLabel: string | null;
  platform: string;
  createdAt: Date;
  lastUsedAt: Date;
}

export function createAuthRepo(db: Db) {
  return {
    // ------------------------------------------------------------ users

    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    async findUserById(id: string): Promise<UserRow | undefined> {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)))
        .limit(1);
      return row;
    },

    /** The email is already verified (the user proved it with a code) and the age check has passed. */
    async createUser(input: { email: string; termsVersion: string; now: Date }): Promise<UserRow> {
      const [row] = await db
        .insert(users)
        .values({
          email: input.email,
          emailVerifiedAt: input.now,
          ageConfirmedAt: input.now,
          termsVersion: input.termsVersion,
          termsAcceptedAt: input.now,
        })
        .returning();
      return row!;
    },

    async markOnboarded(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ onboardedAt: now }).where(eq(users.id, userId));
    },

    /**
     * Moves the account to an address its owner just proved with a code, so it is verified as of now.
     * When another row holds the address, in any case, the unique index on lower(email) raises the
     * driver's unique violation; the flow reports that as email_in_use.
     */
    async changeEmail(userId: string, email: string, now: Date): Promise<void> {
      await db.update(users).set({ email, emailVerifiedAt: now }).where(eq(users.id, userId));
    },

    /**
     * The keyed hash of the phone number behind the verified badge, or null to drop it. When another row
     * holds the same hash, the partial unique index on phone_hash raises the driver's unique violation;
     * the flow reports that as phone_in_use.
     */
    async setPhoneHash(userId: string, phoneHash: string | null): Promise<void> {
      await db.update(users).set({ phoneHash }).where(eq(users.id, userId));
    },

    /** Setting or clearing a password also clears any password lockout. */
    async setPasswordHash(userId: string, passwordHash: string | null, now: Date): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, passwordChangedAt: now, failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, userId));
    },

    /** Replaces the hash only, after a sign-in verified the password against older parameters. */
    async replacePasswordHash(userId: string, passwordHash: string): Promise<void> {
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    },

    async setPasswordFailures(userId: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
      await db.update(users).set({ failedLogins, lockedUntil }).where(eq(users.id, userId));
    },

    async enableTotp(userId: string, input: { secretEnc: string; recoveryCodesHash: string[]; now: Date }): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: input.secretEnc, totpEnabledAt: input.now, totpLastStep: null, recoveryCodesHash: input.recoveryCodesHash })
        .where(eq(users.id, userId));
    },

    async disableTotp(userId: string): Promise<void> {
      await db
        .update(users)
        .set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodesHash: [] })
        .where(eq(users.id, userId));
    },

    /** The same secret re-encrypted with the current key; nothing else about MFA changes. */
    async setTotpSecretEnc(userId: string, totpSecretEnc: string): Promise<void> {
      await db.update(users).set({ totpSecretEnc }).where(eq(users.id, userId));
    },

    async setRecoveryCodes(userId: string, recoveryCodesHash: string[]): Promise<void> {
      await db.update(users).set({ recoveryCodesHash }).where(eq(users.id, userId));
    },

    /** Claims a TOTP time step. False when this step or a later one was already used. */
    async claimTotpStep(userId: string, step: number): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ totpLastStep: step })
        .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    /** Removes one recovery-code hash. False when it is not (or no longer) present. */
    async consumeRecoveryCodeHash(userId: string, codeHash: string): Promise<boolean> {
      const rows = await db
        .update(users)
        .set({ recoveryCodesHash: sql`array_remove(${users.recoveryCodesHash}, ${codeHash})` })
        .where(and(eq(users.id, userId), sql`${codeHash} = ANY(${users.recoveryCodesHash})`))
        .returning({ id: users.id });
      return rows.length === 1;
    },

    async setRole(userId: string, role: UserRole): Promise<void> {
      await db.update(users).set({ role }).where(eq(users.id, userId));
    },

    // ------------------------------------------------------------ deletion

    /**
     * Marks the row deleted and nothing else: from now on every lookup above treats it as absent. Once only; a
     * later call changes nothing. A deletion goes through takeDown; this is the state a take-down that stopped
     * after the mark would leave, which finishTakeDown completes.
     */
    async markDeleted(userId: string, now: Date): Promise<void> {
      await db.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
    },

    /**
     * Step 1 of a deletion (1b design, section 7.6) in one transaction: the row is marked deleted, every live
     * session revoked, every device, code and passkey deleted, the WebAuthn user handle cleared, and the
     * account_deleted event appended. Either all of it lands or none of it does, so a failure leaves a live
     * account with its sessions, never a deleted one with sessions, devices and passkeys that nothing would
     * remove. Answers the ids of the sessions it revoked, for the cache tombstones, which are not the database's
     * to write.
     */
    async takeDown(userId: string, now: Date, deviceId: string | null): Promise<string[]> {
      return db.transaction(async (tx) => {
        await tx.update(users).set({ deletedAt: now }).where(and(eq(users.id, userId), isNull(users.deletedAt)));
        const revoked = await takeDownRows(tx, userId, now);
        await tx.insert(authEvents).values({ userId, type: "account_deleted", deviceId, metadata: {} });
        return revoked;
      });
    },

    /**
     * The rows of step 1 again (the sessions, devices, codes and passkeys, and the WebAuthn user handle), for a row
     * marked deleted and not purged yet: a take-down that stopped after the mark, or a session that a sign-in already
     * past its lookup created after it. Nothing for a live or a purged row. The event is not appended again: the
     * confirmation that recorded it is the only one there was.
     */
    async finishTakeDown(userId: string, now: Date): Promise<string[]> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)));
        return row ? takeDownRows(tx, userId, now) : [];
      });
    },

    /** Deleted accounts whose row the purge has not anonymised yet, oldest deletion first, at most 100 a round. */
    async pendingPurges(): Promise<string[]> {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(isNotNull(users.deletedAt), isNull(users.purgedAt)))
        .orderBy(users.deletedAt, users.id)
        .limit(100);
      return rows.map((r) => r.id);
    },

    /**
     * The last step of a deletion: the address becomes deleted:<id> (unique, and never a real address),
     * every credential and personal fact is cleared, and purged_at says it is done. Only a deleted row
     * not purged yet is written, so a second call, or a call for a live account, changes nothing.
     */
    async finishPurge(userId: string, now: Date): Promise<void> {
      await db
        .update(users)
        .set({
          email: `deleted:${userId}`,
          emailVerifiedAt: null,
          passwordHash: null,
          totpSecretEnc: null,
          totpEnabledAt: null,
          recoveryCodesHash: [],
          phoneHash: null,
          ageConfirmedAt: null,
          termsVersion: null,
          termsAcceptedAt: null,
          purgedAt: now,
        })
        .where(and(eq(users.id, userId), isNotNull(users.deletedAt), isNull(users.purgedAt)));
    },

    // ------------------------------------------------------------ email codes

    async createEmailCode(input: {
      flowId: string;
      email: string;
      userId: string | null;
      purpose: EmailCodePurpose;
      codeHash: string;
      expiresAt: Date;
      ipHash: string | null;
    }): Promise<void> {
      await db.insert(emailCodes).values(input);
    },

    async findEmailCode(flowId: string): Promise<EmailCodeRow | undefined> {
      const [row] = await db.select().from(emailCodes).where(eq(emailCodes.flowId, flowId)).limit(1);
      return row;
    },

    /** Increments the attempt counter atomically and returns the new value. */
    async addCodeAttempt(id: string): Promise<number> {
      const [row] = await db
        .update(emailCodes)
        .set({ attempts: sql`${emailCodes.attempts} + 1` })
        .where(eq(emailCodes.id, id))
        .returning({ attempts: emailCodes.attempts });
      return row?.attempts ?? Number.MAX_SAFE_INTEGER;
    },

    /** Marks a code used. False when it was already used, so a code works exactly once. */
    async consumeEmailCode(id: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(emailCodes)
        .set({ consumedAt: now })
        .where(and(eq(emailCodes.id, id), isNull(emailCodes.consumedAt)))
        .returning({ id: emailCodes.id });
      return rows.length === 1;
    },

    // ------------------------------------------------------------ devices

    async findDevice(userId: string, deviceHash: string): Promise<DeviceRow | undefined> {
      const [row] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.userId, userId), eq(devices.deviceHash, deviceHash), isNull(devices.revokedAt)))
        .limit(1);
      return row;
    },

    /** The device by its row id, revoked or not: a session's device, whose platform names a passkey and whose label the passkey notices carry. */
    async findDeviceById(id: string): Promise<DeviceRow | undefined> {
      const [row] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
      return row;
    },

    async createDevice(input: { userId: string; deviceHash: string; label: string; platform: string; ipHash: string | null }): Promise<DeviceRow> {
      const [row] = await db.insert(devices).values(input).returning();
      return row!;
    },

    async touchDevice(id: string, ipHash: string | null, now: Date): Promise<void> {
      await db.update(devices).set({ lastSeenAt: now, ipHash }).where(eq(devices.id, id));
    },

    /** A revoked device no longer carries live sessions and counts as new at its next sign-in. */
    async revokeDevice(id: string, now: Date): Promise<void> {
      await db.update(devices).set({ revokedAt: now }).where(and(eq(devices.id, id), isNull(devices.revokedAt)));
    },

    /** Every device of the user, as revokeDevice revokes one: the next sign-in on any of them counts as a new device. */
    async revokeDevices(userId: string, now: Date): Promise<void> {
      await db.update(devices).set({ revokedAt: now }).where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
    },

    /** The user's devices that are not revoked, oldest first, for the data export; a revoked one stands for nothing of the account's any more. */
    async listDevices(userId: string): Promise<{ label: string | null; platform: string; firstSeenAt: Date; lastSeenAt: Date }[]> {
      return db
        .select({ label: devices.label, platform: devices.platform, firstSeenAt: devices.firstSeenAt, lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .orderBy(devices.firstSeenAt, devices.id);
    },

    // ------------------------------------------------------------ sessions

    /**
     * A new session with the factors its sign-in proved (kind to epoch milliseconds from the flows' clock) and the passkey
     * that started it, if one did. The reauth time is the latest of the factors, which is what freshness is read from. A row
     * without factors, as migration 0010 left the sessions from before it, re-authenticates before its next sensitive action.
     */
    async createSession(input: {
      id: string;
      userId: string;
      deviceId: string;
      now: Date;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      factors?: Record<string, number>;
      passkeyId?: string | null;
    }): Promise<void> {
      const factors = input.factors ?? {};
      const times = Object.values(factors);
      await db.insert(sessions).values({
        id: input.id,
        userId: input.userId,
        deviceId: input.deviceId,
        createdAt: input.now,
        lastUsedAt: input.now,
        reauthAt: times.length > 0 ? new Date(Math.max(...times)) : input.now,
        expiresAt: input.expiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        factors,
        passkeyId: input.passkeyId ?? null,
      });
    },

    /** A session counts only when neither it, its device nor its user is revoked, deleted or expired. */
    async findActiveSession(id: string, now: Date): Promise<ActiveSessionRow | undefined> {
      const [row] = await db
        .select({
          id: sessions.id,
          userId: sessions.userId,
          deviceId: sessions.deviceId,
          role: users.role,
          onboardedAt: users.onboardedAt,
          totpEnabledAt: users.totpEnabledAt,
          reauthAt: sessions.reauthAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
          absoluteExpiresAt: sessions.absoluteExpiresAt,
          handle: sessions.handle,
          factors: sessions.factors,
          passkeyId: sessions.passkeyId,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(
          and(
            eq(sessions.id, id),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
            gt(sessions.absoluteExpiresAt, now),
            isNull(users.deletedAt),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1);
      return row;
    },

    async slideSession(id: string, expiresAt: Date, now: Date): Promise<void> {
      await db.update(sessions).set({ expiresAt, lastUsedAt: now }).where(eq(sessions.id, id));
    },

    /**
     * Records a factor the session proved at `at`: the kind's time is set or replaced, and reauth_at, the latest of
     * them, follows the write. The flows always pass their clock's now.
     */
    async writeFactor(id: string, kind: string, at: Date): Promise<void> {
      await db
        .update(sessions)
        .set({ factors: sql`${sessions.factors} || ${JSON.stringify({ [kind]: at.getTime() })}::jsonb`, reauthAt: at })
        .where(eq(sessions.id, id));
    },

    /**
     * Replaces the session's id, the token's hash, and nothing else, for a live session only: the handle, factors, reauth
     * time, passkey, device and expiries stay. False when the session is revoked or gone, so a rotation never revives one.
     * Nothing references sessions.id, so the primary key changes in place.
     */
    async rotateSession(id: string, newId: string): Promise<boolean> {
      const rows = await db
        .update(sessions)
        .set({ id: newId })
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length === 1;
    },

    /** Revokes one session of this user. False when it does not belong to the user or is already revoked. */
    async revokeSession(id: string, userId: string, now: Date): Promise<boolean> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.id, id), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length === 1;
    },

    /** Revokes every live session of the user and returns their ids (for cache invalidation). */
    async revokeAllSessions(userId: string, now: Date): Promise<string[]> {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.map((r) => r.id);
    },

    async listActiveSessions(userId: string, now: Date): Promise<SessionListRow[]> {
      return db
        .select({
          id: sessions.id,
          deviceLabel: devices.label,
          platform: devices.platform,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
        })
        .from(sessions)
        .innerJoin(devices, eq(devices.id, sessions.deviceId))
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.absoluteExpiresAt, now)))
        .orderBy(desc(sessions.lastUsedAt));
    },

    // ------------------------------------------------------------ passkeys

    /**
     * The account's WebAuthn user handle, set to `candidate` when there is none yet (1c design, section 6): a
     * compare-and-set in one statement, so two registrations at once end with the same handle, whichever wrote it.
     * Undefined for an account that is gone.
     */
    async ensureWebauthnUserId(userId: string, candidate: Buffer): Promise<Buffer | undefined> {
      const [row] = await db
        .update(users)
        .set({ webauthnUserId: sql`coalesce(${users.webauthnUserId}, ${candidate})` })
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .returning({ webauthnUserId: users.webauthnUserId });
      return row?.webauthnUserId ?? undefined;
    },

    async countPasskeys(userId: string): Promise<number> {
      const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, userId));
      return row?.count ?? 0;
    },

    /** The account's passkeys newest first, each with the label of the device that added it, for the Security list and the options' exclusions. */
    async listPasskeys(userId: string): Promise<PasskeyListRow[]> {
      return db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(eq(passkeys.userId, userId))
        .orderBy(desc(passkeys.createdAt), desc(passkeys.id));
    },

    /** One passkey of the account, with its device's label. Undefined when it is another account's or gone, which the flows do not tell apart. */
    async findPasskey(id: string, userId: string): Promise<PasskeyListRow | undefined> {
      const [row] = await db
        .select({ ...getTableColumns(passkeys), createdOn: devices.label })
        .from(passkeys)
        .leftJoin(devices, eq(devices.id, passkeys.createdDeviceId))
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * The passkey a sign-in's credential id names, whichever account it belongs to (1c design, section 7.4): the assertion
     * says nothing about the account, so the flow finds the owner from here. Undefined for an unknown credential; the flow
     * then reads the owner and refuses a deleted one, so a gone account never signs in.
     */
    async findPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)).limit(1);
      return row;
    },

    /**
     * A passkey the session's account holds, by credential id (1c design, section 7.2): the re-authentication looks it up
     * with the session's user, so another account's passkey and an unknown one are alike undefined and never re-authenticate.
     */
    async findPasskeyByCredential(credentialId: string, userId: string): Promise<PasskeyRow | undefined> {
      const [row] = await db
        .select()
        .from(passkeys)
        .where(and(eq(passkeys.credentialId, credentialId), eq(passkeys.userId, userId)))
        .limit(1);
      return row;
    },

    /**
     * Writes a verified passkey's use in one conditional update (1c design, section 2), in the pattern of claimTotpStep: the
     * new counter, the use time and the current backup state, only for a passkey that is not suspect and whose counter moved
     * forward (two zeros, as synced passkeys always send, pass repeatedly). False when it matched no row, which the flow
     * reads, after a verified signature, as a counter regression or a race lost to one.
     */
    async claimPasskeyUse(id: string, newCounter: number, backedUp: boolean, now: Date): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ counter: newCounter, lastUsedAt: now, backedUp })
        .where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt), sql`((${newCounter} = 0 and ${passkeys.counter} = 0) or ${newCounter} > ${passkeys.counter})`))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /** Marks a passkey suspect once (1c design, section 2), so a later sign-in with it is refused; a second call changes nothing. */
    async suspectPasskey(id: string, now: Date): Promise<void> {
      await db.update(passkeys).set({ suspectAt: now }).where(and(eq(passkeys.id, id), isNull(passkeys.suspectAt)));
    },

    /** The daily bound's reading for the options step; the registration's transaction reads it again. */
    async recentPasskeyAdditions(userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
      return recentPasskeyAdditions(db, userId, withinMs, limit);
    },

    /**
     * A registration's transaction (1c design, section 7.3): the user row locked `for update`, so two registrations of one
     * account run one after the other and the later one sees what the earlier committed; both bounds checked again there;
     * then the passkey and its passkey_added event, or neither. A credential id already held raises the driver's unique
     * violation, which the flow reports as passkey_invalid.
     */
    async addPasskey(input: NewPasskey, limits: PasskeyLimits): Promise<AddPasskeyOutcome> {
      return db.transaction(async (tx): Promise<AddPasskeyOutcome> => {
        const [locked] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
          .for("update");
        if (!locked) return { ok: false, reason: "gone" };
        const [held] = await tx.select({ count: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, input.userId));
        if ((held?.count ?? 0) >= limits.passkeys) return { ok: false, reason: "cap" };
        const additions = await recentPasskeyAdditions(tx, input.userId, limits.windowMs, limits.additions);
        if (additions.count >= limits.additions) return { ok: false, reason: "daily", retryAfterSeconds: additions.retryAfterSeconds };
        const [passkey] = await tx.insert(passkeys).values(input).returning();
        await tx.insert(authEvents).values({ userId: input.userId, type: "passkey_added", deviceId: input.createdDeviceId, metadata: { passkeyId: passkey!.id } });
        return { ok: true, passkey: passkey! };
      });
    },

    /** Renames one passkey of the account. False when it is another account's or gone. */
    async renamePasskey(id: string, userId: string, name: string): Promise<boolean> {
      const rows = await db
        .update(passkeys)
        .set({ name })
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ id: passkeys.id });
      return rows.length === 1;
    },

    /**
     * Removes one passkey of the account and answers its name, for the notice; undefined when it is another account's or
     * gone. The sessions it started keep running without it: the foreign key sets their passkey_id to null.
     */
    async deletePasskey(id: string, userId: string): Promise<{ name: string } | undefined> {
      const [row] = await db
        .delete(passkeys)
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
        .returning({ name: passkeys.name });
      return row;
    },

    /**
     * The lockdown's removal (1c design, section 7.6): the user's passkeys created at or after `since`, plus any of theirs
     * the caller names, whatever their age. Answers the ids removed, for the caller's event. A named passkey of another
     * account is not the caller's to remove and stays.
     */
    async deletePasskeys(userId: string, input: { since: Date; ids: readonly string[] }): Promise<string[]> {
      const reach = input.ids.length > 0 ? or(gte(passkeys.createdAt, input.since), inArray(passkeys.id, [...input.ids])) : gte(passkeys.createdAt, input.since);
      const rows = await db
        .delete(passkeys)
        .where(and(eq(passkeys.userId, userId), reach))
        .returning({ id: passkeys.id });
      return rows.map((row) => row.id);
    },

    // ------------------------------------------------------------ events

    async appendEvent(input: {
      userId: string | null;
      type: AuthEventType;
      deviceId?: string | null;
      ipHash?: string | null;
      metadata?: Record<string, unknown>;
    }): Promise<void> {
      await db.insert(authEvents).values({
        userId: input.userId,
        type: input.type,
        deviceId: input.deviceId ?? null,
        ipHash: input.ipHash ?? null,
        metadata: input.metadata ?? {},
      });
    },

    // ------------------------------------------------------------ retention

    /** Codes consumed or expired before `before` are of no use to anyone; they still hold an email and an ip hash. */
    async purgeEmailCodes(before: Date): Promise<number> {
      const rows = await db
        .delete(emailCodes)
        .where(or(and(sql`${emailCodes.consumedAt} is not null`, lt(emailCodes.consumedAt, before)), lt(emailCodes.expiresAt, before)))
        .returning({ id: emailCodes.id });
      return rows.length;
    },

    /** Sessions revoked or expired before `before`. Live ones are never touched. */
    async purgeSessions(before: Date): Promise<number> {
      const rows = await db
        .delete(sessions)
        .where(or(and(sql`${sessions.revokedAt} is not null`, lt(sessions.revokedAt, before)), lt(sessions.expiresAt, before), lt(sessions.absoluteExpiresAt, before)))
        .returning({ id: sessions.id });
      return rows.length;
    },

    /** The design's IP-hash purge: a device not seen since `before` keeps no address hash. */
    async purgeDeviceIpHashes(before: Date): Promise<number> {
      const rows = await db
        .update(devices)
        .set({ ipHash: null })
        .where(and(sql`${devices.ipHash} is not null`, lt(devices.lastSeenAt, before)))
        .returning({ id: devices.id });
      return rows.length;
    },

    /**
     * Events older than `days` days, through auth.purge_events (migration 0007): the table stays
     * append-only for this role, which holds no DELETE on it; the function is owned by the migrator.
     */
    async purgeEvents(days: number): Promise<number> {
      const [row] = (await db.execute(sql`select auth.purge_events(make_interval(days => ${days}::int)) as removed`)) as unknown as { removed: number }[];
      return Number(row?.removed ?? 0);
    },

    async recentEvents(userId: string, limit = 20) {
      return db
        .select({ type: authEvents.type, deviceId: authEvents.deviceId, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(eq(authEvents.userId, userId))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id))
        .limit(limit);
    },

    /** The user's own events since `since`, newest first, for the data export: their kind and time, never the metadata. */
    async eventsSince(userId: string, since: Date): Promise<{ type: AuthEventType; createdAt: Date }[]> {
      return db
        .select({ type: authEvents.type, createdAt: authEvents.createdAt })
        .from(authEvents)
        .where(and(eq(authEvents.userId, userId), gte(authEvents.createdAt, since)))
        .orderBy(desc(authEvents.createdAt), desc(authEvents.id));
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** What a read runs through: the pool, or a transaction that needs the read to see its own lock. */
type Querier = Pick<Db, "select">;

/**
 * The daily bound's reading (1c design, section 2): how many passkey_added events the account has within the window, at
 * most `limit` of them, and the seconds until the oldest of those is out of the window, when the day has a slot again.
 * Counted from the events, so a removal frees nothing, and by the database clock, which wrote them.
 */
async function recentPasskeyAdditions(q: Querier, userId: string, withinMs: number, limit: number): Promise<{ count: number; retryAfterSeconds: number }> {
  const window = sql`make_interval(secs => ${withinMs / 1000}::float8)`;
  const recent = q
    .select({ createdAt: authEvents.createdAt })
    .from(authEvents)
    .where(and(eq(authEvents.userId, userId), eq(authEvents.type, "passkey_added"), gt(authEvents.createdAt, sql`now() - ${window}`)))
    .orderBy(desc(authEvents.createdAt))
    .limit(limit)
    .as("recent");
  const [row] = await q
    .select({
      count: sql<number>`count(*)::int`,
      retryAfterSeconds: sql<number>`coalesce(ceil(extract(epoch from (min(${recent.createdAt}) + ${window} - now())))::int, 0)`,
    })
    .from(recent);
  return { count: row?.count ?? 0, retryAfterSeconds: row?.retryAfterSeconds ?? 0 };
}

/**
 * The rows step 1 of a deletion takes down, inside the caller's transaction: every live session is revoked
 * (its id answered, for the cache tombstones), every device is deleted, and with it by cascade every session
 * row, every code out for the user goes, whatever its purpose, so none can complete a flow for an account
 * that is gone, and every passkey goes with the WebAuthn user handle (1c design, section 7.7), so a deleted
 * account keeps no credential of any kind and no assertion can name it again. Run again by finishTakeDown,
 * each statement finds nothing more to do.
 */
async function takeDownRows(tx: Tx, userId: string, now: Date): Promise<string[]> {
  const revoked = await tx
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  await tx.delete(devices).where(eq(devices.userId, userId));
  await tx.delete(emailCodes).where(eq(emailCodes.userId, userId));
  await tx.delete(passkeys).where(eq(passkeys.userId, userId));
  // The handle only ever named the account to its passkeys; cleared here rather than by finishPurge, so the take-down leaves nothing of the ceremony behind.
  await tx.update(users).set({ webauthnUserId: null }).where(eq(users.id, userId));
  return revoked.map((row) => row.id);
}

export type AuthRepo = ReturnType<typeof createAuthRepo>;
```

### Replace `packages/contracts/src/account.ts` (whole file)

```ts
import { z } from "zod";
import { Platform, Role } from "./auth";

const at = z.iso.datetime();

/** Something the account did to a post (a like, a repost, a bookmark), and when. */
const PostRef = z.object({ postId: z.uuid(), at });

/** The other side of a graph relation by the handle it had at export time (nothing else about them), and since when. */
const HandleRef = z.object({ handle: z.string(), since: at });

/** An image attached to one of the account's posts; `file` names its entry in the archive. */
const ExportedMedia = z.object({ id: z.uuid(), file: z.string(), altText: z.string(), width: z.number().int().positive(), height: z.number().int().positive() });

/** A post as its author wrote it; a deleted one keeps its place with an empty body and its deletion time. */
const ExportedPost = z.object({
  id: z.uuid(),
  body: z.string(),
  createdAt: at,
  replyToId: z.uuid().nullable(),
  quoteOfId: z.uuid().nullable(),
  state: z.enum(["visible", "withheld", "removed", "deleted_by_author"]),
  deletedAt: at.nullable(),
  media: z.array(ExportedMedia),
});

/** A passkey of the account as the export lists it (1c design, section 7.7): what the Security screen shows, and nothing that identifies the key, its id or its authenticator. */
const ExportedPasskey = z.object({
  name: z.string(),
  createdAt: at,
  lastUsedAt: at.nullable(),
  /** Backed up, so the password manager syncs it to the owner's other devices. */
  synced: z.boolean(),
  /** The label of the device that added it; null once that device is gone. */
  createdOn: z.string().nullable(),
});

/**
 * export.json inside the data export archive (1b design, section 7.5): everything the account owns, and
 * nothing about other people beyond the handle they had at export time.
 */
export const ExportFormat = z.object({
  format: z.literal("korbat-export-1"),
  exportedAt: at,
  account: z.object({
    id: z.uuid(),
    email: z.email(),
    createdAt: at,
    role: Role,
    mfaEnabled: z.boolean(),
    hasPassword: z.boolean(),
    verified: z.boolean(),
    termsVersion: z.string().nullable(),
    termsAcceptedAt: at.nullable(),
    /** The account's passkeys, newest first. Added to korbat-export-1 without a new format name: a reader that does not know the member loses nothing by skipping it. */
    passkeys: z.array(ExportedPasskey),
  }),
  profile: z.object({
    handle: z.string(),
    displayName: z.string(),
    bio: z.string(),
    createdAt: at,
    /** Every handle the account ever had, the current one included. */
    handleHistory: z.array(z.string()),
  }),
  posts: z.array(ExportedPost),
  likes: z.array(PostRef),
  reposts: z.array(PostRef),
  bookmarks: z.array(PostRef),
  following: z.array(HandleRef),
  blocks: z.array(HandleRef),
  mutes: z.array(HandleRef),
  sessions: z.array(z.object({ id: z.string(), createdAt: at, lastUsedAt: at, current: z.boolean() })),
  devices: z.array(z.object({ label: z.string().nullable(), platform: Platform, firstSeenAt: at, lastSeenAt: at })),
  /** The account's own security events: their kind and time, without the metadata. */
  events: z.array(z.object({ type: z.string(), at })),
  /** Ids of ready images whose file was not on disk when the archive was written. */
  missingMedia: z.array(z.string()),
});
export type ExportFormat = z.infer<typeof ExportFormat>;
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/contracts test:       Tests  89 passed (89)
packages/db test:       Tests  27 passed (27)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  32 passed (32)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  414 passed | 240 skipped (654)
```

## Step 6: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
Tests  238 passed (238)
```

## Step 7: verify: api-bundle

```bash
pnpm --filter @korbat/api build 2>&1 | tail -2 && node --check apps/api/dist/index.js && echo bundle-ok
```

Expected output contains:

- `Build success`
- `bundle-ok`

Must not contain:

- `SyntaxError`

Observed on the dry run:

```text
Build success
bundle-ok
```

## Step 8: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/account/flows/export.ts`
- `apps/api/src/auth/flows/deletion.ts`
- `apps/api/src/auth/flows/export.ts`
- `apps/api/src/auth/index.ts`
- `apps/api/src/auth/repo.ts`
- `apps/api/test/account/export.test.ts`
- `apps/api/test/auth/deletion.test.ts`
- `apps/api/test/auth/flow-harness.ts`
- `apps/api/test/integration/account-export.test.ts`
- `apps/api/test/integration/account-takedown.test.ts`
- `packages/contracts/src/account.ts`
- `packages/contracts/test/account.test.ts`

## Step 9: commit

```bash
git add -A
git commit -q -m "feat(api,contracts): deletion and export cover passkeys: takeDown and finishTakeDown delete the account's passkeys and clear its WebAuthn user handle inside their transaction, and a deleted account's passkey stays refused after the take-down and the purge; the export lists the passkeys (name, dates, synced, the adding device) with no key material, credential id, AAGUID or id, in ExportFormat.account.passkeys, byte-identical to the streamed document" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(api,contracts): deletion and export cover passkeys: takeDown and finishTakeDown delete the account's passkeys and clear its WebAuthn user handle inside their transaction, and a deleted account's passkey stays refused after the take-down and the purge; the export lists the passkeys (name, dates, synced, the adding device) with no key material, credential id, AAGUID or id, in ExportFormat.account.passkeys, byte-identical to the streamed document`.

## Report format (mandatory)

```text
TASK 6 REPORT
Files written: <count, expected 12>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "api-bundle": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
