import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, describe, expect, test } from "vitest";
import { MATCH_FIXTURES } from "@korbat/media-protocol";
import { createMediaFiles } from "../../src/media/files";
import {
  MATCH_ACTING,
  MATCH_LISTED,
  TEST_LISTED_CLASS,
  TEST_LIST_VERSION,
  TEST_SOURCE,
  TEST_UNLISTED_CLASS,
  matchAdapterFrom,
  matchRequest,
  matchedHash,
  type TestMatchAdapter,
  type UploadHashes,
} from "../../src/media/match-adapter";

/**
 * The comparison's adapter (3d design, sections 5 "The adapters", 7.8 and 12.2; Task 7): `off`, `test` and a source's
 * name, chosen by MEDIA_MATCH. The test adapter answers on the digests of the two byte-constant PNG files alone, which
 * node:crypto's digests of the same bytes are; one function builds a request, from the four hashes and nothing else; and
 * the upload's bytes are hashed as they are received, before anything else is done with them. This build computes no
 * PDQ: the owner has not allowed the fetch of the reference's vectors, so no request carries one.
 */
const sha = (algorithm: "sha256" | "sha1" | "md5", bytes: Uint8Array) => createHash(algorithm).update(bytes).digest();
const hashesOf = (bytes: Uint8Array): UploadHashes => ({ sha256: sha("sha256", bytes), sha1: sha("sha1", bytes), md5: sha("md5", bytes) });
const test_ = () => matchAdapterFrom({ MEDIA_MATCH: "test", APP_SITE: "closed" }) as TestMatchAdapter;

describe("the adapter", () => {
  test("off: the default, which is asked nothing and sends nothing", async () => {
    const off = matchAdapterFrom({ MEDIA_MATCH: "off", APP_SITE: "open" });
    expect(off.mode).toBe("off");
    expect(off.source).toBeNull();
    await expect(off.check(matchRequest(hashesOf(MATCH_FIXTURES.acting)))).rejects.toThrow(/off/);
  });

  test("a source's name stops the start: no such adapter in this build; the test adapter only on a closed site", () => {
    expect(() => matchAdapterFrom({ MEDIA_MATCH: "iwf", APP_SITE: "closed" })).toThrow("no such adapter in this build");
    expect(() => matchAdapterFrom({ MEDIA_MATCH: "test", APP_SITE: "open" })).toThrow(/APP_SITE is open/);
  });

  test("test: the acting file is an exact SHA-256 match of the listed and acting class; the flag file is near (SHA-1) or of the unlisted class (MD5); anything else is clear", async () => {
    const adapter = test_();
    expect([adapter.mode, adapter.source, adapter.listed, adapter.acting]).toEqual(["test", TEST_SOURCE, [TEST_LISTED_CLASS], [TEST_LISTED_CLASS]]);
    expect(await adapter.check(matchRequest(hashesOf(MATCH_FIXTURES.acting)))).toEqual({ state: "matched", hashType: "sha256", kind: "exact", classification: TEST_LISTED_CLASS, listVersion: TEST_LIST_VERSION });
    expect(await adapter.check(matchRequest(hashesOf(MATCH_FIXTURES.flag)))).toEqual({ state: "matched", hashType: "sha1", kind: "near", classification: TEST_LISTED_CLASS, listVersion: TEST_LIST_VERSION });
    adapter.flag = "unlisted";
    expect(await adapter.check(matchRequest(hashesOf(MATCH_FIXTURES.flag)))).toEqual({ state: "matched", hashType: "md5", kind: "exact", classification: TEST_UNLISTED_CLASS, listVersion: TEST_LIST_VERSION });
    expect(await adapter.check(matchRequest(hashesOf(new TextEncoder().encode("any other file"))))).toEqual({ state: "clear" });
    adapter.silent = true;
    expect(await adapter.check(matchRequest(hashesOf(MATCH_FIXTURES.acting)))).toEqual({ state: "unanswered" });
    adapter.silent = false;
    adapter.matchAll = true;
    expect((await adapter.check(matchRequest(hashesOf(new TextEncoder().encode("x"))))).state).toBe("matched");
    expect(adapter.requests).toHaveLength(6);
  });

  test("MATCH_LISTED and MATCH_ACTING: the test adapter's one pair, acting a part of listed", () => {
    expect(MATCH_LISTED).toEqual({ test: ["test_listed"] });
    expect(MATCH_ACTING).toEqual({ test: ["test_listed"] });
    for (const [source, acting] of Object.entries(MATCH_ACTING)) for (const classification of acting) expect(MATCH_LISTED[source]).toContain(classification);
  });
});

describe("the request builder", () => {
  test("it takes the four hashes alone and sends each as lower-case hexadecimal; no PDQ in this build, so the member is absent", () => {
    const hashes = hashesOf(MATCH_FIXTURES.acting);
    const request = matchRequest(hashes);
    expect(Object.keys(request).sort()).toEqual(["md5", "sha1", "sha256"]);
    expect(request).not.toHaveProperty("pdq");
    expect(request.sha256).toBe("4088e46614abf60d00aed74d6062e2a363f78f022c0565e231277fb13b9b93c1");
    expect(request.sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(request.md5).toMatch(/^[0-9a-f]{32}$/);
    // Were a worker to give a PDQ, it would travel as hexadecimal too, and only then.
    expect(matchRequest({ ...hashes, pdq: new Uint8Array(32).fill(171) }).pdq).toBe("ab".repeat(32));
    // A caller cannot smuggle anything else through: the builder copies the four members it knows.
    expect(Object.keys(matchRequest({ ...hashes, id: "x", owner: "y" } as UploadHashes)).sort()).toEqual(["md5", "sha1", "sha256"]);
  });

  test("the match record keeps the hash the match rests on, never another", () => {
    const hashes = hashesOf(MATCH_FIXTURES.flag);
    expect(Buffer.from(matchedHash(hashes, "sha1")!).toString("hex")).toBe(createHash("sha1").update(MATCH_FIXTURES.flag).digest("hex"));
    expect(matchedHash(hashes, "pdq")).toBeNull();
  });
});

describe("the three hashers in receive (7.8)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "korbat-match-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const chunked = (bytes: Uint8Array, size: number) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += size) controller.enqueue(bytes.subarray(at, at + size));
        controller.close();
      },
    });

  test("the bytes as received, in chunks of any size, give node:crypto's SHA-256, SHA-1 and MD5 of the whole file", async () => {
    const base = path.join(root, randomUUID());
    const files = createMediaFiles({ uploadsDir: path.join(base, "uploads"), storeDir: path.join(base, "store"), log: pino({ level: "silent" }) });
    await files.prepare();
    for (const dir of [files.store.files, files.store.results, files.store.attempts, files.store.tmp]) mkdirSync(dir, { recursive: true });
    for (const size of [1, 7, 4096]) {
      const received = await files.receiveHashed(randomUUID(), chunked(MATCH_FIXTURES.flag, size), 10_000, () => undefined);
      expect(received.bytes).toBe(MATCH_FIXTURES.flag.length);
      expect(Buffer.from(received.hashes.sha256).equals(sha("sha256", MATCH_FIXTURES.flag))).toBe(true);
      expect(Buffer.from(received.hashes.sha1).equals(sha("sha1", MATCH_FIXTURES.flag))).toBe(true);
      expect(Buffer.from(received.hashes.md5).equals(sha("md5", MATCH_FIXTURES.flag))).toBe(true);
    }
  });
});
