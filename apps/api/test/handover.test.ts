import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, test } from "vitest";
import { MEDIA_SIZES } from "@korbat/contracts";
import { isStoredName, runHandover, storedName, zipStored } from "../src/handover";
import { storedImageName } from "../src/media";

const LF = String.fromCharCode(10);
const sha256 = (data: Buffer | Uint8Array) => createHash("sha256").update(data).digest("hex");

/**
 * The hand-over's program (3f design, section 7.14 step 2; invariant 16), as a unit: against a store of harmless files
 * that are not images, in a temporary directory. The archive's entries equal the list byte for byte and are stored, not
 * compressed; a name outside the store's layout, a missing file and a list that names a file twice are refused with no
 * archive; the printed digests are the files' and the archive's. The store's naming rule exists twice, exported by the
 * media module and copied in handover.ts: the two are fed the same names and must agree.
 */
describe("the hand-over's program", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A store with these images' files, each size a few harmless bytes of its own, and an empty directory for the archive. */
  function store(ids: string[]) {
    const root = mkdtempSync(path.join(tmpdir(), "korbat-handover-"));
    dirs.push(root);
    const storeDir = path.join(root, "store");
    const out = path.join(root, "out");
    mkdirSync(out, { recursive: true });
    const files = new Map<string, Buffer>();
    for (const id of ids) {
      for (const size of MEDIA_SIZES) {
        const name = storedName(id, size);
        const data = Buffer.from(`not an image: ${size} of ${id} ${"x".repeat(size === "large" ? 300 : 30)}`, "utf8");
        mkdirSync(path.join(storeDir, ...name.split("/").slice(0, -1)), { recursive: true });
        writeFileSync(path.join(storeDir, ...name.split("/")), data);
        files.set(name, data);
      }
    }
    return { storeDir, out, files };
  }
  async function run(input: string, storeDir: string, out: string) {
    const lines: string[] = [];
    const errors: string[] = [];
    const code = await runHandover({ input, store: storeDir, out, log: (line) => lines.push(line), error: (line) => errors.push(line) });
    return { code, lines, errors };
  }

  test("the store's naming rule in its two copies: the media module's and the program's give the same names, and the program accepts exactly those", () => {
    for (let i = 0; i < 200; i++) {
      const id = randomUUID();
      for (const size of MEDIA_SIZES) {
        expect(storedName(id, size)).toBe(storedImageName(id, size));
        expect(isStoredName(storedImageName(id, size))).toBe(true);
      }
    }
    const id = randomUUID();
    const other = randomUUID();
    for (const name of [
      `files/${other.slice(0, 2) === id.slice(0, 2) ? "zz" : other.slice(0, 2)}/${id}/small.webp`,
      `files/${id.slice(0, 2)}/${id}/huge.webp`,
      `files/${id.slice(0, 2)}/${id.toUpperCase()}/small.webp`,
      `files/${id.slice(0, 2)}/../../${id}/small.webp`,
      `/etc/passwd`,
      `results/${id}.json`,
      `files/${id.slice(0, 2)}/${id}/small.webp/x`,
      `files/${id.slice(0, 2)}/${id}/small.webp${String.fromCharCode(0)}`,
      `files${String.fromCharCode(92)}${id.slice(0, 2)}${String.fromCharCode(92)}${id}${String.fromCharCode(92)}small.webp`,
      "",
    ]) {
      expect(isStoredName(name), JSON.stringify(name)).toBe(false);
    }
    expect(() => storedName("not-an-id", "small")).toThrow();
    expect(() => storedImageName("not-an-id", "small")).toThrow();
  });

  test("copies exactly the listed files, byte for byte, into one archive of stored entries, and prints each file's and the archive's size and SHA-256", async () => {
    const ids = [randomUUID(), randomUUID()];
    const s = store(ids);
    const production = randomUUID();
    const names = [...s.files.keys()];
    const done = await run([`production ${production}`, ...names, ""].join(LF), s.storeDir, s.out);
    expect(done.errors).toEqual([]);
    expect(done.code).toBe(0);
    const archivePath = path.join(s.out, `handover-${production}.zip`);
    const archive = readFileSync(archivePath);
    expect(done.lines).toEqual([...names.map((name) => `${name} ${s.files.get(name)!.length} ${sha256(s.files.get(name)!)}`), `archive ${archive.length} ${sha256(archive)}`]);
    // A ZIP reader finds exactly the listed entries, with the files' bytes.
    const entries = unzipSync(new Uint8Array(archive));
    expect(Object.keys(entries)).toEqual(names);
    for (const name of names) expect(Buffer.from(entries[name]!)).toEqual(s.files.get(name));
    // Each local header: stored (method 0), with the file's own CRC-32 and size twice, then the bytes as they are.
    let at = 0;
    for (const name of names) {
      const data = s.files.get(name)!;
      expect(archive.readUInt32LE(at)).toBe(0x04034b50);
      expect(archive.readUInt16LE(at + 8)).toBe(0);
      expect(archive.readUInt32LE(at + 14)).toBe(crc32(data));
      expect([archive.readUInt32LE(at + 18), archive.readUInt32LE(at + 22)]).toEqual([data.length, data.length]);
      const nameLength = archive.readUInt16LE(at + 26);
      expect(archive.subarray(at + 30, at + 30 + nameLength).toString("utf8")).toBe(name);
      expect(archive.subarray(at + 30 + nameLength, at + 30 + nameLength + data.length)).toEqual(data);
      at += 30 + nameLength + data.length;
    }
    // A second run never overwrites the archive of the first.
    const again = await run([`production ${production}`, ...names].join(LF), s.storeDir, s.out);
    expect(again.code).toBe(1);
    expect(again.lines).toEqual([]);
    expect(readFileSync(archivePath)).toEqual(archive);
  });

  test("refuses a name outside the store's layout, a missing file, a list without its production and a file named twice, each with no archive", async () => {
    const id = randomUUID();
    const s = store([id]);
    const production = randomUUID();
    const target = path.join(s.out, `handover-${production}.zip`);
    const names = [...s.files.keys()];
    const outside = await run([`production ${production}`, names[0], "../../outside.webp"].join(LF), s.storeDir, s.out);
    expect([outside.code, outside.lines, outside.errors]).toEqual([1, [], ['handover: refused: "../../outside.webp" is outside the store']]);
    const missing = storedName(randomUUID(), "small");
    const gone = await run([`production ${production}`, names[0], missing].join(LF), s.storeDir, s.out);
    expect([gone.code, gone.lines, gone.errors]).toEqual([1, [], [`handover: ${missing} is missing or is not a plain file of the store; no archive was written`]]);
    expect((await run(names.join(LF), s.storeDir, s.out)).code).toBe(1);
    expect((await run([`production ${production}`, names[0], names[0]].join(LF), s.storeDir, s.out)).code).toBe(1);
    // A directory where a file should be is no plain file either.
    const dirId = randomUUID();
    mkdirSync(path.join(s.storeDir, ...storedName(dirId, "small").split("/")), { recursive: true });
    expect((await run([`production ${production}`, storedName(dirId, "small")].join(LF), s.storeDir, s.out)).code).toBe(1);
    expect(existsSync(target)).toBe(false);
  });

  test("3f's review: a write that fails halfway leaves no part of the files behind and says so; an earlier run's file, whole or not, is never overwritten and must be deleted first", async () => {
    const id = randomUUID();
    const s = store([id]);
    const production = randomUUID();
    const input = [`production ${production}`, ...s.files.keys()].join(LF);
    const name = `handover-${production}.zip`;
    // A full disk: half the archive is written, then the write fails.
    const errors: string[] = [];
    const failing = await runHandover({
      input,
      store: s.storeDir,
      out: s.out,
      log: () => undefined,
      error: (line) => errors.push(line),
      writeArchive: async (file, data) => {
        await file.write(data.subarray(0, Math.floor(data.length / 2)));
        throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
      },
    });
    expect(failing).toBe(1);
    expect(errors).toEqual([`handover: ${name} could not be written (ENOSPC); what was written of it was deleted, and no archive was written`]);
    expect(readdirSync(s.out)).toEqual([]);
    // An earlier run's archive stands: the next run refuses, says what to do, and leaves it as it was.
    writeFileSync(path.join(s.out, name), "an earlier run's bytes");
    const again = await run(input, s.storeDir, s.out);
    expect([again.code, again.lines]).toEqual([1, []]);
    expect(again.errors).toEqual([`handover: ${name} or ${name}.part exists from an earlier run; it may be incomplete and holds the files it lists: delete it before running again; what was written of it was deleted`]);
    expect(readFileSync(path.join(s.out, name), "utf8")).toBe("an earlier run's bytes");
    expect(readdirSync(s.out)).toEqual([name]);
    // An earlier run's part, left by a run that was killed: refused before anything is written.
    rmSync(path.join(s.out, name));
    writeFileSync(path.join(s.out, `${name}.part`), "half");
    const killed = await run(input, s.storeDir, s.out);
    expect([killed.code, killed.errors]).toEqual([1, [`handover: ${name} or ${name}.part exists from an earlier run; it may be incomplete and holds the files it lists: delete it before running again; no archive was written`]]);
    // Once it is deleted, the run writes the archive under its name alone.
    rmSync(path.join(s.out, `${name}.part`));
    expect((await run(input, s.storeDir, s.out)).code).toBe(0);
    expect(readdirSync(s.out)).toEqual([name]);
  });

  test("the zip writer: an empty file and a name of several bytes a character, read back by a reader, with CRC-32s from node:zlib", () => {
    const files = [
      { name: "files/aa/empty", data: Buffer.alloc(0) },
      { name: `files/${String.fromCodePoint(0xe9)}/two`, data: Buffer.from([0, 1, 2, 255]) },
    ];
    const archive = zipStored(files);
    const entries = unzipSync(new Uint8Array(archive));
    expect(Object.keys(entries)).toEqual(files.map((file) => file.name));
    expect(Buffer.from(entries[files[1]!.name]!)).toEqual(files[1]!.data);
    expect(archive.readUInt32LE(14)).toBe(crc32(files[0]!.data));
    // The end record counts both entries.
    expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50);
    expect(archive.readUInt16LE(archive.length - 12)).toBe(2);
  });
});
