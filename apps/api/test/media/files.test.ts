import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, describe, expect, test } from "vitest";
import { MAX_VARIANT_BYTES, SNIFF_BYTES } from "@korbat/media-protocol";
import { MediaError } from "../../src/media/context";
import { createMediaFiles } from "../../src/media/files";

const root = mkdtempSync(path.join(tmpdir(), "korbat-media-files-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function volumes(storeDevice?: number) {
  const base = path.join(root, randomUUID());
  const files = createMediaFiles({ uploadsDir: path.join(base, "uploads"), storeDir: path.join(base, "store"), log: pino({ level: "silent" }), storeDevice });
  await files.prepare();
  for (const dir of [files.store.files, files.store.results, files.store.attempts, files.store.tmp]) mkdirSync(dir, { recursive: true });
  return files;
}

/** A body that arrives in chunks and declares no length, like a chunked upload. */
function chunked(...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      controller.close();
    },
  });
}
const accept = () => undefined;

describe("receiving an upload", () => {
  test("the body is streamed to tmp/ and only becomes an upload when committed", async () => {
    const files = await volumes();
    const id = randomUUID();
    expect(await files.receive(id, chunked("hello ", "world"), 100, accept)).toBe(11);
    expect(readFileSync(files.uploads.part(id), "utf8")).toBe("hello world");
    expect(existsSync(files.uploads.upload(id))).toBe(false);
    await files.commit(id);
    expect(readFileSync(files.uploads.upload(id), "utf8")).toBe("hello world");
    expect(existsSync(files.uploads.part(id))).toBe(false);
  });

  test("the first bytes are judged before anything is written", async () => {
    const files = await volumes();
    const id = randomUUID();
    let seen = 0;
    let onDisk = true;
    const body = chunked(new Uint8Array(200).fill(1), new Uint8Array(200).fill(2), new Uint8Array(200).fill(3));
    await files.receive(id, body, 10_000, (head) => {
      seen = head.byteLength;
      onDisk = existsSync(files.uploads.part(id));
    });
    expect(seen).toBe(SNIFF_BYTES);
    expect(onDisk).toBe(false);
    expect(statSync(files.uploads.part(id)).size).toBe(600);
  });

  test("a refused head leaves no file behind", async () => {
    const files = await volumes();
    const id = randomUUID();
    const refuse = () => {
      throw new MediaError("unsupported_media_type", 415);
    };
    await expect(files.receive(id, chunked("%PDF-1.7"), 100, refuse)).rejects.toMatchObject({ code: "unsupported_media_type", status: 415 });
    expect(readdirSync(files.uploads.tmp)).toEqual([]);
  });

  test("an empty or missing body reaches the judge as zero bytes", async () => {
    const files = await volumes();
    const heads: number[] = [];
    await files.receive(randomUUID(), chunked(), 100, (head) => void heads.push(head.byteLength));
    await files.receive(randomUUID(), null, 100, (head) => void heads.push(head.byteLength));
    expect(heads).toEqual([0, 0]);
  });

  test("bytes are counted as they arrive: one byte over the limit ends the upload and removes the file", async () => {
    const files = await volumes();
    const id = randomUUID();
    const kib = new Uint8Array(1024);
    await expect(files.receive(id, chunked(kib, kib, kib, new Uint8Array(1)), 3 * 1024, accept)).rejects.toMatchObject({ code: "file_too_large", status: 413 });
    expect(readdirSync(files.uploads.tmp)).toEqual([]);
    expect(await files.receive(randomUUID(), chunked(kib, kib, kib), 3 * 1024, accept)).toBe(3 * 1024);
  });

  test("the same id cannot be received twice", async () => {
    const files = await volumes();
    const id = randomUUID();
    await files.receive(id, chunked("a"), 100, accept);
    await expect(files.receive(id, chunked("b"), 100, accept)).rejects.toMatchObject({ code: "EEXIST" });
  });

  test("discarding removes an upload whether it was committed or not", async () => {
    const files = await volumes();
    const [partial, complete] = [randomUUID(), randomUUID()];
    await files.receive(partial, chunked("a"), 100, accept);
    await files.receive(complete, chunked("b"), 100, accept);
    await files.commit(complete);
    await files.discardUpload(partial);
    await files.discardUpload(complete);
    await files.discardUpload(randomUUID());
    expect([...readdirSync(files.uploads.tmp), ...readdirSync(files.uploads.incoming)]).toEqual([]);
  });

  test("preparing again clears half-received bodies and keeps complete uploads", async () => {
    const files = await volumes();
    const [partial, complete] = [randomUUID(), randomUUID()];
    await files.receive(partial, chunked("a"), 100, accept);
    await files.receive(complete, chunked("b"), 100, accept);
    await files.commit(complete);
    await files.prepare();
    expect(readdirSync(files.uploads.tmp)).toEqual([]);
    expect(readdirSync(files.uploads.incoming)).toEqual([complete]);
  });
});

describe("2d Task 3: an avatar's upload (design, section 7.2)", () => {
  test("its SHA-256 is always taken while it streams, and the three hashes of the comparison only when asked", async () => {
    const files = await volumes();
    const body = ["first chunk ", "second chunk"];
    const sha256 = createHash("sha256").update(body.join("")).digest("hex");
    const alone = await files.receiveAvatar(randomUUID(), chunked(...body), 100, accept, false);
    expect(alone).toEqual({ bytes: 24, sha256, hashes: null });
    const matched = await files.receiveAvatar(randomUUID(), chunked(...body), 100, accept, true);
    expect(matched.sha256).toBe(sha256);
    expect(matched.hashes?.sha256.toString("hex")).toBe(sha256);
    expect(matched.hashes?.md5.toString("hex")).toBe(createHash("md5").update(body.join("")).digest("hex"));
    // The cap and the head's judge hold as for any upload.
    await expect(files.receiveAvatar(randomUUID(), chunked("x".repeat(101)), 100, accept, false)).rejects.toMatchObject({ code: "file_too_large" });
  });

  test("commit writes the job file, one line of JSON through tmp/, before the upload is renamed into incoming/", async () => {
    const files = await volumes();
    const id = randomUUID();
    await files.receive(id, chunked("avatar bytes"), 100, accept);
    await files.commit(id, { avatar: "centre" });
    expect(readFileSync(files.uploads.avatarJob(id), "utf8")).toBe(`${JSON.stringify({ v: 1, crop: "centre" })}${String.fromCharCode(10)}`);
    expect(readFileSync(files.uploads.upload(id), "utf8")).toBe("avatar bytes");
    expect(readdirSync(files.uploads.tmp)).toEqual([]);
    // The job file comes first: a rename that fails (here, no part was received) leaves it in place, and never an upload
    // in incoming/ without its job.
    const lost = randomUUID();
    await expect(files.commit(lost, { avatar: "end" })).rejects.toMatchObject({ code: "ENOENT" });
    expect(existsSync(files.uploads.avatarJob(lost))).toBe(true);
    expect(existsSync(files.uploads.upload(lost))).toBe(false);
    // A post's upload has none.
    const post = randomUUID();
    await files.receive(post, chunked("post bytes"), 100, accept);
    await files.commit(post);
    expect(existsSync(files.uploads.avatarJob(post))).toBe(false);
  });

  test("discarding an upload removes its job file too; storedUploads lists a job file left alone under its id, for the reconcile pass", async () => {
    const files = await volumes();
    const id = randomUUID();
    await files.receive(id, chunked("a"), 100, accept);
    await files.commit(id, { avatar: "start" });
    await files.discardUpload(id);
    expect(readdirSync(files.uploads.incoming)).toEqual([]);
    // A crash between the job file's write and the rename: the job file alone, which the reconcile pass sees by its id.
    const orphan = randomUUID();
    writeFileSync(files.uploads.avatarJob(orphan), JSON.stringify({ v: 1, crop: "start" }));
    writeFileSync(path.join(files.uploads.incoming, "stray.avatar"), "x");
    const listed = await files.storedUploads(Date.now() + 60_000);
    expect(listed.map((entry) => entry.id)).toEqual([orphan]);
    expect(listed[0]!.ageMs).toBeGreaterThan(50_000);
    await files.discardUpload(orphan);
    expect(readdirSync(files.uploads.incoming)).toEqual(["stray.avatar"]);
  });
});

describe("reading the store, which is not trusted", () => {
  const ready = (id: string) => ({ v: 1, id, status: "ready", width: 800, height: 600, blurhash: "L2Eo_P_3jb_3" });

  test("a result that follows the protocol is returned", async () => {
    const files = await volumes();
    const id = randomUUID();
    expect(await files.readResult(id)).toBeNull();
    writeFileSync(files.store.result(id), JSON.stringify(ready(id)));
    expect(await files.readResult(id)).toEqual(ready(id));
  });

  test("anything else is ignored: not JSON, extra keys, another id, too large, a directory", async () => {
    const files = await volumes();
    const [a, b, c, d, e] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    writeFileSync(files.store.result(a), "not json");
    writeFileSync(files.store.result(b), JSON.stringify({ ...ready(b), path: "/etc/passwd" }));
    writeFileSync(files.store.result(c), JSON.stringify(ready(randomUUID())));
    writeFileSync(files.store.result(d), JSON.stringify({ ...ready(d), blurhash: "x".repeat(40_000) }));
    mkdirSync(files.store.result(e));
    for (const id of [a, b, c, d, e]) expect(await files.readResult(id), id).toBeNull();
  });

  test("an image is opened with its size, and the caller gets a handle to stream", async () => {
    const files = await volumes();
    const id = randomUUID();
    expect(await files.openImage(id, "large")).toBeNull();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    writeFileSync(files.store.image(id, "large"), "webp-bytes");
    const stored = await files.openImage(id, "large");
    expect(stored?.size).toBe(10);
    expect(await stored!.handle.readFile("utf8")).toBe("webp-bytes");
    await stored!.handle.close();
  });

  test("a file on another device is refused: that is what a symlink out of the volume looks like", async () => {
    const files = await volumes(-1);
    const id = randomUUID();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    writeFileSync(files.store.image(id, "large"), "webp-bytes");
    writeFileSync(files.store.result(id), JSON.stringify(ready(id)));
    expect(await files.openImage(id, "large")).toBeNull();
    expect(await files.readResult(id)).toBeNull();
  });

  test.skipIf(process.platform === "win32")("a symlink in place of an image is not followed", async () => {
    const files = await volumes();
    const id = randomUUID();
    const secret = path.join(root, `${randomUUID()}.secret`);
    writeFileSync(secret, "DATABASE_URL=secret");
    mkdirSync(files.store.imageDir(id), { recursive: true });
    symlinkSync(secret, files.store.image(id, "large"));
    expect(await files.openImage(id, "large")).toBeNull();
  });

  test.skipIf(process.platform === "win32")("a FIFO in place of an image is refused at once instead of blocking a thread", { timeout: 5_000 }, async () => {
    const files = await volumes();
    const id = randomUUID();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    execFileSync("mkfifo", [files.store.image(id, "large")]);
    expect(await files.openImage(id, "large")).toBeNull();
    expect(await files.readResult(id)).toBeNull();
  });

  test("an oversized image and a directory are refused", async () => {
    const files = await volumes();
    const [big, dir] = [randomUUID(), randomUUID()];
    mkdirSync(files.store.imageDir(big), { recursive: true });
    writeFileSync(files.store.image(big, "small"), "");
    truncateSync(files.store.image(big, "small"), MAX_VARIANT_BYTES + 1);
    mkdirSync(files.store.image(dir, "small"), { recursive: true });
    expect(await files.openImage(big, "small")).toBeNull();
    expect(await files.openImage(dir, "small")).toBeNull();
  });
});

describe("deletion requests and the sweeper's view", () => {
  test("a request is an empty file; it is withdrawn once nothing remains", async () => {
    const files = await volumes();
    const id = randomUUID();
    mkdirSync(files.store.imageDir(id), { recursive: true });
    await files.requestDeletion([id]);
    await files.requestDeletion([id]);
    expect(await files.deletionRequests()).toEqual([id]);
    expect(statSync(files.uploads.deletion(id)).size).toBe(0);
    expect(await files.imageRemains(id)).toBe(true);
    rmSync(files.store.imageDir(id), { recursive: true });
    expect(await files.imageRemains(id)).toBe(false);
    await files.withdrawDeletion(id);
    expect(await files.deletionRequests()).toEqual([]);
  });

  test("a deletion that is owed is a marker the worker never reads: it is no request until one is written, it is listed with its age, and it is forgotten by id", async () => {
    const files = await volumes();
    const [first, second] = [randomUUID(), randomUUID()];
    expect(existsSync(files.uploads.owed)).toBe(true);
    await files.oweDeletion([first, second]);
    await files.oweDeletion([first]);
    expect((await files.owedDeletions(Date.now() + 5_000)).map((entry) => entry.id).sort()).toEqual([first, second].sort());
    for (const entry of await files.owedDeletions(Date.now() + 5_000)) expect(entry.ageMs).toBeGreaterThanOrEqual(4_000);
    expect(statSync(files.uploads.owedDeletion(first)).size).toBe(0);
    // The directory the worker reads holds nothing of it.
    expect(await files.deletionRequests()).toEqual([]);
    expect(readdirSync(files.uploads.deletions)).toEqual([]);
    await files.settleOwed([first, randomUUID()]);
    expect((await files.owedDeletions(Date.now())).map((entry) => entry.id)).toEqual([second]);
    // A name that is no image's id is not listed.
    writeFileSync(path.join(files.uploads.owed, "notes.txt"), "");
    expect((await files.owedDeletions(Date.now())).map((entry) => entry.id)).toEqual([second]);
  });

  test("a deletion cannot be owed where the marker cannot be written: the caller's transaction then fails, and no row goes", async () => {
    const files = await volumes();
    rmSync(files.uploads.owed, { recursive: true });
    // A plain file where the directory was: nothing can be created under it.
    writeFileSync(files.uploads.owed, "");
    await expect(files.oweDeletion([randomUUID()])).rejects.toThrow();
    // Nothing owed is nothing to write.
    await files.oweDeletion([]);
    expect(await files.owedDeletions(Date.now())).toEqual([]);
  });

  test("a leftover result also counts as remaining", async () => {
    const files = await volumes();
    const id = randomUUID();
    writeFileSync(files.store.result(id), "{}");
    expect(await files.imageRemains(id)).toBe(true);
  });

  test("images and uploads on disk are listed with their age; stray names are skipped", async () => {
    const files = await volumes();
    const [image, upload, partial] = [randomUUID(), randomUUID(), randomUUID()];
    mkdirSync(files.store.imageDir(image), { recursive: true });
    mkdirSync(path.join(files.store.files, "zz", "stray"), { recursive: true });
    mkdirSync(path.join(files.store.files, image.slice(0, 2), "not-an-id"), { recursive: true });
    await files.receive(upload, chunked("a"), 100, accept);
    await files.commit(upload);
    await files.receive(partial, chunked("b"), 100, accept);
    writeFileSync(path.join(files.uploads.incoming, "stray"), "x");
    const now = Date.now() + 60_000;
    expect((await files.storedImages(now)).map((entry) => entry.id)).toEqual([image]);
    expect((await files.storedImages(now))[0]!.ageMs).toBeGreaterThan(50_000);
    expect((await files.storedUploads(now)).map((entry) => entry.id).sort()).toEqual([upload, partial].sort());
  });
});

describe("heartbeat and free space", () => {
  test("the heartbeat's age is measured against the clock; a missing or broken one is null", async () => {
    const files = await volumes();
    expect(await files.heartbeatAge(1_000)).toBeNull();
    writeFileSync(files.store.heartbeat, JSON.stringify({ v: 1, at: 1_000 }));
    expect(await files.heartbeatAge(31_000)).toBe(30_000);
    writeFileSync(files.store.heartbeat, "soon");
    expect(await files.heartbeatAge(31_000)).toBeNull();
    writeFileSync(files.store.heartbeat, JSON.stringify({ v: 1, at: 1_000, pid: 7 }));
    expect(await files.heartbeatAge(31_000)).toBeNull();
  });

  test("free space is a number of bytes", async () => {
    const files = await volumes();
    expect(await files.freeBytes()).toBeGreaterThan(0);
  });
});
