import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import pino from "pino";
import { afterAll, describe, expect, test } from "vitest";
import { ExportFormat } from "@korbat/contracts";
import { AccountError, type AccountDeps } from "../../src/account/context";
import { EXPORT_WINDOW_MS, buildExport, enforceExportLimit, exportFilename, mediaEntry, writeExport } from "../../src/account/flows/export";
import { createZipWriter } from "../../src/account/zip";
import type { AuthEventType } from "../../src/auth";
import { MemoryStore } from "../../src/middleware/rate-limit";

const root = mkdtempSync(path.join(tmpdir(), "korbat-account-export-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const T0 = 1_789_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A file of the given bytes in a fresh directory, and its absolute path. */
function fileOf(bytes: Uint8Array): string {
  const dir = path.join(root, randomUUID());
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "large.webp");
  writeFileSync(file, bytes);
  return file;
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
    bytes: (): Uint8Array => Buffer.concat(chunks),
    get overlapped() {
      return overlapped;
    },
    get count() {
      return chunks.length;
    },
  };
}

/** Every entry of the central directory with its compression method (0 stored, 8 deflated), in archive order. */
function centralDirectory(archive: Uint8Array): [string, number][] {
  const bytes = Buffer.from(archive);
  const entries: [string, number][] = [];
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (bytes.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = bytes.readUInt16LE(i + 28);
    entries.push([bytes.toString("utf8", i + 46, i + 46 + nameLength), bytes.readUInt16LE(i + 10)]);
  }
  return entries;
}

interface RecordedEvent {
  userId: string;
  type: AuthEventType;
  metadata: Record<string, unknown> | undefined;
}

/**
 * The export flow on fakes of the three module interfaces: an account with two live sessions,
 * one device and two events; a profile with a post carrying two images and a deleted reply, one
 * like, one bookmark, a follow, a block and a mute; and whatever images the test puts in `images`.
 */
function harness() {
  let t = T0;
  const images: { id: string; path: string }[] = [];
  const userId = randomUUID();
  const currentSession = randomBytes(32).toString("hex");
  const otherSession = randomBytes(32).toString("hex");
  const [postId, deletedId, likedId, bookmarkedId, imageA, imageB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const events: RecordedEvent[] = [];
  const deps: AccountDeps = {
    auth: {
      exportAccount: async (id) => ({
        account: { id, email: "ada@korbat.local", createdAt: new Date(T0 - 3 * DAY_MS), role: "user", mfaEnabled: true, hasPassword: false, verified: true, termsVersion: "draft-test", termsAcceptedAt: new Date(T0 - 3 * DAY_MS) },
        sessions: [
          { id: otherSession, createdAt: new Date(T0 - 2 * DAY_MS), lastUsedAt: new Date(T0 - DAY_MS) },
          { id: currentSession, createdAt: new Date(T0 - DAY_MS), lastUsedAt: new Date(T0) },
        ],
        devices: [{ label: "Chrome on Windows", platform: "web", firstSeenAt: new Date(T0 - 3 * DAY_MS), lastSeenAt: new Date(T0) }],
        events: [
          { type: "signin_success", at: new Date(T0 - DAY_MS) },
          { type: "signup", at: new Date(T0 - 3 * DAY_MS) },
        ],
      }),
      appendEvent: async (id, type, metadata) => {
        events.push({ userId: id, type, metadata });
      },
    },
    social: {
      exportProfile: async () => ({
        profile: { handle: "ada", displayName: "Ada", bio: "Analytical engines.", createdAt: new Date(T0 - 3 * DAY_MS), handleHistory: ["ada_old", "ada"] },
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
      }),
    },
    media: { exportImages: async () => images },
    limits: new MemoryStore(() => t),
    log: pino({ level: "silent" }),
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
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("building the export", () => {
  test("the JSON follows the contract, marks the current session, and keeps a deleted post with its empty body and deletion time", async () => {
    const h = harness();
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    const json = ExportFormat.parse(plan.json);
    expect(json.format).toBe("korbat-export-1");
    expect(json.exportedAt).toBe(iso(T0));
    expect(json.account).toEqual({ id: h.userId, email: "ada@korbat.local", createdAt: iso(T0 - 3 * DAY_MS), role: "user", mfaEnabled: true, hasPassword: false, verified: true, termsVersion: "draft-test", termsAcceptedAt: iso(T0 - 3 * DAY_MS) });
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
    h.images.push({ id: randomUUID(), path: path.join(root, "a") }, { id: randomUUID(), path: path.join(root, "b") });
    const plan = await buildExport(h.deps, h.userId, h.currentSession, h.now());
    expect(plan.images).toEqual(h.images);
    expect(mediaEntry(h.images[0]!.id)).toBe(`media/${h.images[0]!.id}.webp`);
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
    h.images.push({ id: h.imageA, path: fileOf(bytesA) }, { id: h.imageB, path: fileOf(bytesB) });
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
    const json = ExportFormat.parse(JSON.parse(strFromU8(files["export.json"]!)));
    expect(json.posts[0]!.media.map((m) => m.file)).toEqual([`media/${h.imageA}.webp`, `media/${h.imageB}.webp`]);
    expect(json.missingMedia).toEqual([]);
    expect(centralDirectory(sink.bytes())).toEqual([
      [`media/${h.imageA}.webp`, 0],
      [`media/${h.imageB}.webp`, 0],
      ["export.json", 8],
    ]);
  });

  test("an image whose file is gone is listed under missingMedia, and the archive still closes with the others", async () => {
    const bytesA = Buffer.from("still-there");
    const h = harness();
    h.images.push({ id: h.imageA, path: fileOf(bytesA) }, { id: h.imageB, path: path.join(root, randomUUID(), "large.webp") });
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
    expect(plan.json.missingMedia).toEqual([h.imageB]);
  });
});

describe("the zip writer", () => {
  test("entries come out in the order they were added: JSON deflated with two-space indentation, files stored as they are", async () => {
    const stored = randomBytes(70_000);
    const file = fileOf(stored);
    const first = { kind: "first", filler: "x".repeat(2_000) };
    const last = { kind: "last" };
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    await writer.addJson("first.json", first);
    expect(await writer.addFile("files/stored.bin", file)).toBe(true);
    await writer.addJson("last.json", last);
    await writer.end();

    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toEqual(["first.json", "files/stored.bin", "last.json"]);
    expect(strFromU8(files["first.json"]!)).toBe(JSON.stringify(first, null, 2));
    expect(Buffer.compare(Buffer.from(files["files/stored.bin"]!), stored)).toBe(0);
    expect(strFromU8(files["last.json"]!)).toBe(JSON.stringify(last, null, 2));
    expect(centralDirectory(sink.bytes())).toEqual([
      ["first.json", 8],
      ["files/stored.bin", 0],
      ["last.json", 8],
    ]);
    expect(sink.overlapped).toBe(false);
  });

  test("a file that cannot be opened adds nothing and answers false; a directory in its place counts as no file", async () => {
    const dir = path.join(root, randomUUID());
    mkdirSync(dir, { recursive: true });
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    expect(await writer.addFile("missing.bin", path.join(root, randomUUID(), "missing.webp"))).toBe(false);
    expect(await writer.addFile("dir.bin", dir)).toBe(false);
    await writer.addJson("only.json", { ok: true });
    await writer.end();
    const files = unzipSync(sink.bytes());
    expect(Object.keys(files)).toEqual(["only.json"]);
    expect(centralDirectory(sink.bytes())).toEqual([["only.json", 8]]);
  });

  test("an empty archive is still a valid archive", async () => {
    const sink = memorySink();
    const writer = createZipWriter(sink.write);
    await writer.end();
    expect(unzipSync(sink.bytes())).toEqual({});
  });
});
