import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, describe, expect, test } from "vitest";
import { IMPORT_RULES, type ImportSource, type ImportStatus } from "@korbat/contracts";
import { JobFile } from "@korbat/import-protocol";
import { ImportError, type ImportDeps } from "../src/imports/context";
import { createImportFiles } from "../src/imports/files";
import { firstBytesVerdict, receiveChunk, type ChunkRequest } from "../src/imports/flows/chunk";
import type { ImportRepo, ImportRow } from "../src/imports/repo";
import { MemoryStore } from "../src/middleware/rate-limit";

/**
 * The chunked upload (3b design, section 7.3; 12.2): the chunk flow over real files in a temporary import-archives, with
 * a repository that keeps one row in memory as the database's statements would (a move names the state and the size it
 * leaves). Chunks here are 16 bytes, the flow's test seam, so every rule of a chunk is tried on a few bytes; the
 * integration file http-imports.test.ts sends chunks of the real 8 MiB.
 */

const CHUNK = 16;
const OWNER = randomUUID();
const KEY = "ab".repeat(32);
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const stream = (bytes: Uint8Array) => new Response(bytes).body!;

/** A zip's local header, then filler: the first bytes of an X or Mastodon archive. */
function zipBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x50, 0x4b, 0x03, 0x04], 0);
  for (let i = 4; i < size; i++) bytes[i] = (i * 7) % 251;
  return bytes;
}

/** A CAR's first bytes: a varint header length of 58, then a CBOR map of two entries. */
function carBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([58, 0xa2], 0);
  for (let i = 2; i < size; i++) bytes[i] = (i * 13) % 251;
  return bytes;
}

interface Harness {
  deps: ImportDeps;
  row: ImportRow;
  part: string;
  root: string;
  send(at: number, bytes: Uint8Array, extra?: Partial<ChunkRequest>): Promise<{ receivedBytes: number }>;
  refusal(at: number, bytes: Uint8Array, extra?: Partial<ChunkRequest>): Promise<ImportError>;
}

function harness(options: { declared: number; source?: ImportSource; status?: ImportStatus; free?: number }): Harness {
  const root = mkdtempSync(path.join(tmpdir(), "korbat-imports-chunk-"));
  roots.push(root);
  const files = createImportFiles({ archivesDir: path.join(root, "archives"), workDir: path.join(root, "work"), log: pino({ level: "silent" }), freeBytes: async () => options.free ?? 10 * 1024 ** 3 });
  // What files.prepare() makes when the API starts.
  for (const dir of [files.archives.jobs, files.archives.queue, files.archives.deletions]) mkdirSync(dir, { recursive: true });
  const row: ImportRow = {
    id: randomUUID(),
    ownerId: OWNER,
    source: options.source ?? "mastodon",
    status: options.status ?? "uploading",
    declaredBytes: options.declared,
    receivedBytes: 0,
    createdAt: new Date("2026-10-26T10:00:00.000Z"),
    uploadedAt: null,
    scannedAt: null,
    confirmedAt: null,
    endedAt: null,
    failure: null,
    stopReason: null,
    staffRuleId: null,
    refusedAtOriginal: null,
    refusedWords: null,
    scan: null,
    choice: null,
    postsPublished: 0,
    imagesKept: 0,
    imagesLeftOut: 0,
    postsRemoved: 0,
    images: false,
  };
  // What the statements of repo.ts do to the one row: each move names the state and the size it leaves.
  const repo = {
    find: async (id: string, ownerId: string) => (id === row.id && ownerId === OWNER ? { ...row } : null),
    setReceived: async (_id: string, _owner: string, from: number, to: number) => {
      if (row.status !== "uploading" || row.receivedBytes !== from) return false;
      row.receivedBytes = to;
      return true;
    },
    completeUpload: async (_id: string, _owner: string, from: number) => {
      if (row.status !== "uploading" || row.receivedBytes !== from) return false;
      row.status = "scanning";
      row.receivedBytes = row.declaredBytes;
      return true;
    },
    failUpload: async (_id: string, _owner: string, failure: "tar_gz" | "not_an_archive") => {
      if (row.status !== "uploading") return false;
      row.status = "failed";
      row.failure = failure;
      return true;
    },
    accountKey: async () => KEY,
  } as unknown as ImportRepo;
  const deps = {
    repo,
    files,
    limits: new MemoryStore(),
    settings: { imports: true, images: false, sources: ["x", "mastodon"], maxActive: 2, imagesPerHour: 600, minFreeBytes: 1024 },
    log: pino({ level: "silent" }),
    now: () => new Date(),
    chunkBytes: CHUNK,
    inFlight: new Set<string>(),
  } as unknown as ImportDeps;
  const request = (at: number, bytes: Uint8Array, extra: Partial<ChunkRequest> = {}): ChunkRequest => ({ offset: String(at), length: String(bytes.length), sha256: sha(bytes), body: stream(bytes), ...extra });
  const h: Harness = {
    deps,
    row,
    root,
    part: files.archives.part(row.id),
    send: (at, bytes, extra) => receiveChunk(deps, OWNER, row.id, request(at, bytes, extra)),
    async refusal(at, bytes, extra) {
      const err = await receiveChunk(deps, OWNER, row.id, request(at, bytes, extra)).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(err).toBeInstanceOf(ImportError);
      return err as ImportError;
    },
  };
  return h;
}

const sizeOf = (file: string) => (existsSync(file) ? statSync(file).size : null);

/** The refusal a call ends in; a call that is taken fails the test. */
const refusedWith = (call: Promise<unknown>): Promise<ImportError> =>
  call.then(
    () => {
      throw new Error("the chunk was taken");
    },
    (err: unknown) => err as ImportError,
  );

describe("the chunk flow (7.3)", () => {
  test("chunks of exactly the chunk size at the stored offset, the last one shorter, complete the archive: renamed, job.json, the queue marker, scanning", async () => {
    const archive = zipBytes(40);
    const h = harness({ declared: 40 });
    expect(await h.send(0, archive.subarray(0, 16))).toEqual({ receivedBytes: 16 });
    expect(sizeOf(h.part)).toBe(16);
    expect(await h.send(16, archive.subarray(16, 32))).toEqual({ receivedBytes: 32 });
    expect(await h.send(32, archive.subarray(32))).toEqual({ receivedBytes: 40 });
    expect(h.row.status).toBe("scanning");
    expect(existsSync(h.part)).toBe(false);
    const layout = h.deps.files.archives;
    expect(new Uint8Array(readFileSync(layout.archive(h.row.id)))).toEqual(archive);
    const job = JobFile.parse(JSON.parse(readFileSync(layout.job(h.row.id), "utf8")));
    expect(job).toEqual({ v: 1, id: h.row.id, source: "mastodon", accountKey: KEY, images: false, createdAt: "2026-10-26T10:00:00.000Z" });
    expect(existsSync(layout.queued(h.row.id))).toBe(true);
    // The import moved on: a chunk now is wrong_state.
    expect((await h.refusal(40, archive.subarray(0, 1))).code).toBe("wrong_state");
  });

  test("an archive of one chunk shorter than the chunk size completes at once", async () => {
    const archive = zipBytes(5);
    const h = harness({ declared: 5 });
    expect(await h.send(0, archive)).toEqual({ receivedBytes: 5 });
    expect(h.row.status).toBe("scanning");
  });

  test("an offset that is not the stored size is wrong_offset with the stored size, and nothing is written", async () => {
    const archive = zipBytes(48);
    const h = harness({ declared: 48 });
    await h.send(0, archive.subarray(0, 16));
    for (const at of [0, 32, 17]) {
      const err = await h.refusal(at, archive.subarray(at, at + 16));
      expect([err.code, err.status, err.details]).toEqual(["wrong_offset", 409, { receivedBytes: 16 }]);
    }
    expect(sizeOf(h.part)).toBe(16);
  });

  test("a length over the chunk size, a short chunk that does not end the archive, one past the declared size or none at all is chunk_too_large", async () => {
    const archive = zipBytes(40);
    const h = harness({ declared: 40 });
    expect((await h.refusal(0, zipBytes(17))).code).toBe("chunk_too_large");
    expect((await h.refusal(0, archive.subarray(0, 15))).code).toBe("chunk_too_large");
    expect((await h.refusal(0, archive.subarray(0, 16), { length: undefined })).code).toBe("chunk_too_large");
    await h.send(0, archive.subarray(0, 16));
    await h.send(16, archive.subarray(16, 32));
    // 9 bytes would end at 41, past the declared 40.
    const err = await h.refusal(32, zipBytes(9));
    expect([err.code, err.status]).toEqual(["chunk_too_large", 413]);
    expect(sizeOf(h.part)).toBe(32);
  });

  test("a hash that differs, a short body, a body longer than its length and one that breaks off leave archive.part at the stored size (chunk_mismatch)", async () => {
    const archive = zipBytes(48);
    const h = harness({ declared: 48 });
    await h.send(0, archive.subarray(0, 16));
    const next = archive.subarray(16, 32);
    expect((await h.refusal(16, next, { sha256: sha(archive.subarray(0, 16)) })).code).toBe("chunk_mismatch");
    expect(sizeOf(h.part)).toBe(16);
    expect((await h.refusal(16, next, { body: stream(next.subarray(0, 10)) })).code).toBe("chunk_mismatch");
    expect(sizeOf(h.part)).toBe(16);
    expect((await h.refusal(16, next, { body: stream(zipBytes(20)) })).code).toBe("chunk_mismatch");
    expect(sizeOf(h.part)).toBe(16);
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(next.subarray(0, 8));
        controller.error(new Error("the connection was lost"));
      },
    });
    const err = await h.refusal(16, next, { body: broken });
    expect([err.code, err.status]).toEqual(["chunk_mismatch", 400]);
    expect(sizeOf(h.part)).toBe(16);
    // The same chunk sent again whole is taken.
    expect(await h.send(16, next)).toEqual({ receivedBytes: 32 });
  });

  test("malformed headers are invalid_request; an import not the caller's is not_found; one that is not uploading is wrong_state", async () => {
    const h = harness({ declared: 40 });
    const chunk = zipBytes(16);
    expect((await h.refusal(0, chunk, { offset: "-1" })).code).toBe("invalid_request");
    expect((await h.refusal(0, chunk, { offset: "1e3" })).code).toBe("invalid_request");
    expect((await h.refusal(0, chunk, { sha256: sha(chunk).toUpperCase() })).code).toBe("invalid_request");
    expect((await h.refusal(0, chunk, { sha256: undefined })).code).toBe("invalid_request");
    const other = await refusedWith(receiveChunk(h.deps, randomUUID(), h.row.id, { offset: "0", length: "16", sha256: sha(chunk), body: stream(chunk) }));
    expect([other.code, other.status]).toEqual(["not_found", 404]);
    const done = harness({ declared: 40, status: "scanning" });
    expect((await done.refusal(0, chunk)).code).toBe("wrong_state");
  });

  test("the first chunk's first bytes: a zip for X and Mastodon, a CAR for Bluesky; gzip ends the upload as tar_gz, anything else as not_an_archive, and nothing is kept", async () => {
    expect(firstBytesVerdict("x", zipBytes(16))).toBe("ok");
    expect(firstBytesVerdict("mastodon", zipBytes(4))).toBe("ok");
    expect(firstBytesVerdict("bluesky", carBytes(16))).toBe("ok");
    expect(firstBytesVerdict("bluesky", zipBytes(16))).toBe("not_an_archive");
    expect(firstBytesVerdict("x", carBytes(16))).toBe("not_an_archive");
    expect(firstBytesVerdict("x", new Uint8Array([0x1f, 0x8b, 8, 0]))).toBe("tar_gz");
    expect(firstBytesVerdict("bluesky", new Uint8Array([0x1f, 0x8b, 8, 0]))).toBe("tar_gz");
    // An empty zip's end record, and a CAR header too long for a block, are no archives to scan.
    expect(firstBytesVerdict("x", new Uint8Array([0x50, 0x4b, 0x05, 0x06]))).toBe("not_an_archive");
    expect(firstBytesVerdict("bluesky", new Uint8Array([0xff, 0xff, 0x7f, 0xa2]))).toBe("not_an_archive");

    const gzip = harness({ declared: 40 });
    const tar = new Uint8Array(16);
    tar.set([0x1f, 0x8b, 8, 0]);
    const err = await gzip.refusal(0, tar);
    expect([err.code, err.status]).toEqual(["not_an_archive", 400]);
    expect([gzip.row.status, gzip.row.failure]).toEqual(["failed", "tar_gz"]);
    expect(existsSync(gzip.deps.files.archives.jobDir(gzip.row.id))).toBe(false);

    const plain = harness({ declared: 40, source: "bluesky" });
    expect((await plain.refusal(0, zipBytes(16))).code).toBe("not_an_archive");
    expect([plain.row.status, plain.row.failure]).toEqual(["failed", "not_an_archive"]);

    const car = harness({ declared: 20, source: "bluesky" });
    expect(await car.send(0, carBytes(16))).toEqual({ receivedBytes: 16 });
  });

  test("a row behind its file takes the file's size up to whole chunks, never the last one, and the file is cut back to it", async () => {
    const archive = zipBytes(56);
    const h = harness({ declared: 56 });
    await h.send(0, archive.subarray(0, 16));
    // The process stopped after a second chunk was written and before its update, and a third was half written.
    writeFileSync(h.part, archive.subarray(0, 40));
    const err = await h.refusal(16, archive.subarray(16, 32));
    expect([err.code, err.details]).toEqual(["wrong_offset", { receivedBytes: 32 }]);
    expect(h.row.receivedBytes).toBe(32);
    expect(sizeOf(h.part)).toBe(32);
    expect(await h.send(32, archive.subarray(32, 48))).toEqual({ receivedBytes: 48 });
    // The last chunk written but never answered: it is sent again, since its request also completes the archive.
    writeFileSync(h.part, archive);
    expect((await h.refusal(56, archive.subarray(0, 1))).details).toEqual({ receivedBytes: 48 });
    expect(sizeOf(h.part)).toBe(48);
    expect(await h.send(48, archive.subarray(48))).toEqual({ receivedBytes: 56 });
    expect(h.row.status).toBe("scanning");
  });

  test("a file shorter than its row cannot go on: imports_unavailable, and the file is left as it is", async () => {
    const archive = zipBytes(48);
    const h = harness({ declared: 48 });
    await h.send(0, archive.subarray(0, 16));
    writeFileSync(h.part, archive.subarray(0, 8));
    expect((await h.refusal(16, archive.subarray(16, 32))).code).toBe("imports_unavailable");
    expect(sizeOf(h.part)).toBe(8);
  });

  test("free space under IMPORT_MIN_FREE_BYTES refuses a chunk with imports_unavailable (503)", async () => {
    const h = harness({ declared: 40, free: 1023 });
    const err = await h.refusal(0, zipBytes(16));
    expect([err.code, err.status]).toEqual(["imports_unavailable", 503]);
    expect(existsSync(h.part)).toBe(false);
  });

  test("a second chunk of an import while one is on its way in is wrong_offset; each one is counted in import-chunk, 600 an hour", async () => {
    const archive = zipBytes(40);
    const h = harness({ declared: 40 });
    let release: () => void = () => undefined;
    const slow = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(archive.subarray(0, 8));
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        controller.enqueue(archive.subarray(8, 16));
        controller.close();
      },
    });
    const first = h.send(0, archive.subarray(0, 16), { body: slow });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await h.refusal(0, archive.subarray(0, 16))).code).toBe("wrong_offset");
    release();
    expect(await first).toEqual({ receivedBytes: 16 });

    // Counted after the headers are read and before the import is: a chunk of nobody's import counts too.
    const limited = harness({ declared: 40 });
    const nobody = { offset: "0", length: "16", sha256: sha(zipBytes(16)) };
    for (let i = 0; i < IMPORT_RULES.chunksPerHour; i++) await receiveChunk(limited.deps, OWNER, randomUUID(), { ...nobody, body: stream(zipBytes(16)) }).catch(() => undefined);
    const err = await refusedWith(receiveChunk(limited.deps, OWNER, limited.row.id, { ...nobody, body: stream(zipBytes(16)) }));
    expect([err.code, err.status]).toEqual(["rate_limited", 429]);
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
  });
});
