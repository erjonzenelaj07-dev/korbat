import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { IMPORT_RULES, MEDIA_MAX_BYTES } from "@korbat/contracts";
import { ScanFailure, type EntryRule } from "../src/adapters/types";
import { checkEntryName } from "../src/zip/central";
import { openZip, type ZipArchive, type ZipLimits } from "../src/zip/entry";
import { workspace } from "./fixtures/harness";
import { buildZip, noise, type ZipItem, type ZipOptions } from "./fixtures/zip";

/** The zip reader of the 3b design, section 7.2: every limit refuses with its code, and good archives read. */

const ws = workspace();
afterAll(() => ws.remove());

const EVERYTHING: EntryRule[] = [{ pattern: /^.*$/s }];

/** Opens `bytes` as an archive under `rules`, reads every allowlisted entry whole, and closes the file. */
async function withZip<T>(bytes: Buffer, use: (zip: ZipArchive) => Promise<T>, options: { rules?: EntryRule[]; images?: boolean; limits?: Partial<ZipLimits>; seen?: string[] } = {}): Promise<T> {
  const file = path.join(ws.dir, randomUUID());
  writeFileSync(file, bytes);
  const handle = await open(file, "r");
  try {
    const rules = options.rules ?? EVERYTHING;
    const zip = await openZip(handle, bytes.length, {
      rules,
      images: options.images ?? true,
      limits: options.limits,
      onName: (name) => void options.seen?.push(name),
    });
    return await use(zip);
  } finally {
    await handle.close();
  }
}

async function readAll(zip: ZipArchive, name: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of zip.open(name)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** The failure code of a whole read of `items`, or "ok". */
async function outcome(items: ZipItem[], options: ZipOptions = {}, limits?: Partial<ZipLimits>): Promise<string> {
  try {
    await withZip(
      buildZip(items, options),
      async (zip) => {
        for (const entry of zip.entries) await readAll(zip, entry.name);
      },
      { limits },
    );
    return "ok";
  } catch (err) {
    if (err instanceof ScanFailure) return err.code;
    throw err;
  }
}

const TEXT = "korbat reads only what it allows. ".repeat(40);

describe("good archives read", () => {
  test("stored and deflated entries read back whole, and only allowlisted names are listed", async () => {
    const bytes = buildZip([
      { name: "outbox.json", data: TEXT },
      { name: "media/a.jpg", data: noise(5_000), method: 0 },
      { name: "likes.json", data: "never opened" },
    ]);
    await withZip(
      bytes,
      async (zip) => {
        expect(zip.entries.map((entry) => entry.name)).toEqual(["outbox.json", "media/a.jpg"]);
        expect(zip.entries[0]!.size).toBe(Buffer.byteLength(TEXT));
        expect((await readAll(zip, "outbox.json")).toString("utf8")).toBe(TEXT);
        expect(await readAll(zip, "media/a.jpg")).toEqual(noise(5_000));
        expect(zip.has("likes.json")).toBe(false);
        expect(() => zip.open("likes.json")).toThrow();
      },
      { rules: [{ name: "outbox.json" }, { pattern: /^media[/][a-z]+[.]jpg$/ }] },
    );
  });

  test("a ZIP64 archive reads", async () => {
    const bytes = buildZip([{ name: "outbox.json", data: TEXT }, { name: "b.json", data: "{}" }], { zip64: true });
    await withZip(bytes, async (zip) => {
      expect(zip.entries.map((entry) => entry.name)).toEqual(["outbox.json", "b.json"]);
      expect((await readAll(zip, "outbox.json")).toString("utf8")).toBe(TEXT);
    });
  });

  test("an archive with data descriptors (flag bit 3, zero local sizes) reads", async () => {
    const bytes = buildZip([
      { name: "outbox.json", data: TEXT, dataDescriptor: true },
      { name: "second.json", data: TEXT.toUpperCase(), dataDescriptor: true },
    ]);
    expect(await outcome([{ name: "outbox.json", data: TEXT, dataDescriptor: true }, { name: "second.json", data: TEXT, dataDescriptor: true }])).toBe("ok");
    await withZip(bytes, async (zip) => expect((await readAll(zip, "second.json")).toString("utf8")).toBe(TEXT.toUpperCase()));
  });

  test("an archive with ZIP64 local sizes (0xFFFFFFFF and a ZIP64 extra) reads", async () => {
    const bytes = buildZip([{ name: "outbox.json", data: TEXT, zip64Local: true }, { name: "c.bin", data: noise(3_000), method: 0, zip64Local: true }]);
    await withZip(bytes, async (zip) => {
      expect((await readAll(zip, "outbox.json")).toString("utf8")).toBe(TEXT);
      expect(await readAll(zip, "c.bin")).toEqual(noise(3_000));
    });
  });

  test("an images rule applies only while images are on", async () => {
    const bytes = buildZip([{ name: "data.json", data: "{}" }, { name: "pic.jpg", data: noise(100), method: 0 }]);
    const rules: EntryRule[] = [{ name: "data.json" }, { pattern: /^pic[.]jpg$/, images: true }];
    await withZip(bytes, async (zip) => expect(zip.entries.map((entry) => entry.name)).toEqual(["data.json"]), { rules, images: false });
    await withZip(bytes, async (zip) => expect(zip.entries.map((entry) => entry.name)).toEqual(["data.json", "pic.jpg"]), { rules, images: true });
  });
});

describe("step 1: the end record", () => {
  test("a file under 22 bytes, a file without the record, a comment that runs past the end and a second disk are not archives", async () => {
    const refuse = async (bytes: Buffer) => {
      try {
        await withZip(bytes, async () => undefined);
        return "ok";
      } catch (err) {
        return err instanceof ScanFailure ? err.code : String(err);
      }
    };
    expect(await refuse(Buffer.from("PK"))).toBe("not_an_archive");
    expect(await refuse(noise(70_000))).toBe("not_an_archive");
    expect(await refuse(buildZip([{ name: "a.json", data: "{}" }], { comment: Buffer.from("hello"), commentOverrun: 10 }))).toBe("not_an_archive");
    expect(await refuse(buildZip([{ name: "a.json", data: "{}" }], { disk: 1 }))).toBe("not_an_archive");
    expect(await refuse(buildZip([{ name: "a.json", data: "{}" }], { comment: Buffer.from("a comment is fine") }))).toBe("ok");
  });

  test("a central directory that starts outside the file is unreadable", async () => {
    expect(await outcome([{ name: "a.json", data: "{}" }], { directoryOffset: 10_000_000 })).toBe("unreadable");
    expect(await outcome([{ name: "a.json", data: "{}" }], { zip64: true, directoryOffset: 2 ** 40 })).toBe("unreadable");
  });
});

describe("step 2: the central directory and the names", () => {
  test("more entries than ZIP_MAX_ENTRIES, or a directory over 64 MiB, is too_many_entries", async () => {
    expect(IMPORT_RULES.zipMaxEntries).toBe(200_000);
    expect(await outcome([{ name: "a.json", data: "{}" }], { zip64: true, entriesDeclared: 200_001 })).toBe("too_many_entries");
    expect(await outcome([{ name: "a.json", data: "{}" }], { zip64: true, entriesDeclared: 1_000_000 })).toBe("too_many_entries");
    expect(await outcome([{ name: "a.json", data: "{}" }], { directorySize: IMPORT_RULES.zipDirectoryMaxBytes + 1 })).toBe("too_many_entries");
    expect(await outcome([{ name: "a.json", data: "{}" }, { name: "b.json", data: "{}" }, { name: "c.json", data: "{}" }], {}, { maxEntries: 2 })).toBe("too_many_entries");
    expect(await outcome([{ name: "a.json", data: "{}" }, { name: "b.json", data: "{}" }], {}, { maxEntries: 2 })).toBe("ok");
  });

  test("a directory whose entries run past its declared size is unreadable", async () => {
    expect(await outcome([{ name: "a.json", data: "{}" }, { name: "b.json", data: "{}" }], { directorySize: 60 })).toBe("unreadable");
  });

  test("checkEntryName refuses every crafted name and takes ordinary ones", () => {
    const utf8 = (name: string) => checkEntryName(Buffer.from(name, "utf8"), true);
    expect(utf8("data/tweets.js")).toBe("data/tweets.js");
    expect(utf8("media_attachments/files/109/original/0123456789abcdef.jpg")).toBe("media_attachments/files/109/original/0123456789abcdef.jpg");
    expect(utf8("../outbox.json")).toBeNull();
    expect(utf8("data/../outbox.json")).toBeNull();
    expect(utf8("data/./tweets.js")).toBeNull();
    expect(utf8("/outbox.json")).toBeNull();
    expect(utf8("C:/outbox.json")).toBeNull();
    expect(utf8("c:outbox.json")).toBeNull();
    expect(utf8("data" + String.fromCharCode(92) + "tweets.js")).toBeNull();
    expect(utf8("data" + String.fromCharCode(0) + "tweets.js")).toBeNull();
    expect(utf8("data//tweets.js")).toBeNull();
    expect(utf8("")).toBeNull();
    expect(utf8("a".repeat(513))).toBeNull();
    expect(utf8("a".repeat(512))).toBe("a".repeat(512));
    // Not UTF-8 although flag bit 11 says so, and a CP437 name (bit 11 clear) beyond ASCII.
    expect(checkEntryName(Buffer.from([0x64, 0xff, 0xfe]), true)).toBeNull();
    expect(checkEntryName(Buffer.from([0x64, 0x82]), false)).toBeNull();
    expect(checkEntryName(Buffer.from("plain.json", "latin1"), false)).toBe("plain.json");
  });

  test("an entry whose name fails is never offered to the allowlist and never opened, only counted", async () => {
    const crafted: ZipItem[] = [
      { name: "../outbox.json", data: "{}" },
      { name: "/outbox.json", data: "{}" },
      { name: "C:/outbox.json", data: "{}" },
      { name: "data" + String.fromCharCode(92) + "outbox.json", data: "{}" },
      { name: Buffer.from("outbox.json" + String.fromCharCode(0) + ".txt", "utf8"), data: "{}" },
      { name: "a".repeat(513), data: "{}" },
    ];
    const seen: string[] = [];
    await withZip(
      buildZip([{ name: "outbox.json", data: "{}" }, ...crafted]),
      async (zip) => {
        expect(zip.entries.map((entry) => entry.name)).toEqual(["outbox.json"]);
        expect(zip.refusedNames).toBe(crafted.length);
      },
      { seen },
    );
    expect(seen).toEqual(["outbox.json"]);
  });

  test("a directory or a symbolic link is ignored and never opened, whatever its name", async () => {
    const seen: string[] = [];
    await withZip(
      buildZip([
        { name: "outbox.json", data: "{}" },
        { name: "data/", data: "", directory: true, method: 0 },
        { name: "actor.json", data: "/etc/passwd", symlink: true, method: 0 },
      ]),
      async (zip) => expect(zip.entries.map((entry) => entry.name)).toEqual(["outbox.json"]),
      { seen },
    );
    expect(seen).toEqual(["outbox.json"]);
  });
});

describe("step 3: two entries with one allowlisted name", () => {
  test("refuse the archive (bad_entry_name)", async () => {
    expect(await outcome([{ name: "outbox.json", data: "{}" }, { name: "x.json", data: "{}" }], { duplicateCentral: 0 })).toBe("bad_entry_name");
  });

  test("but not when the name is outside the allowlist", async () => {
    const bytes = buildZip([{ name: "outbox.json", data: "{}" }, { name: "likes.json", data: "{}" }], { duplicateCentral: 1 });
    await withZip(bytes, async (zip) => expect(zip.entries.map((entry) => entry.name)).toEqual(["outbox.json"]), { rules: [{ name: "outbox.json" }] });
  });
});

describe("step 4: each allowlisted entry", () => {
  test("encryption is encrypted, a method other than stored or deflate is unreadable", async () => {
    expect(await outcome([{ name: "a.json", data: "{}", encrypted: true }])).toBe("encrypted");
    expect(await outcome([{ name: "a.json", data: "{}", method: 12 }])).toBe("unreadable");
  });

  test("a data file over 1 GiB, an entry whose ratio is over 100, and a sum over 4 GiB are too_large_uncompressed", async () => {
    expect(IMPORT_RULES.zipDataMaxBytes).toBe(1_073_741_824);
    expect(await outcome([{ name: "a.json", data: noise(20_000_000), method: 0, declaredSize: IMPORT_RULES.zipDataMaxBytes + 1 }])).toBe("too_large_uncompressed");
    expect(await outcome([{ name: "a.json", data: Buffer.alloc(2_000_000) }])).toBe("too_large_uncompressed");
    expect(await outcome([{ name: "a.json", data: Buffer.alloc(100_000), method: 0, declaredSize: 100 * 1_000 + 1, declaredCompressed: 1_000 }])).not.toBe("ok");
    const three = [1, 2, 3].map((n) => ({ name: `${n}.json`, data: noise(1_000, n), method: 0 as const }));
    expect(await outcome(three, {}, { totalMaxBytes: 2_999 })).toBe("too_large_uncompressed");
    expect(await outcome(three, {}, { totalMaxBytes: 3_000 })).toBe("ok");
  });

  test("an image over 20 MiB is not a refusal of the archive: its size is listed, and the core counts it too_large unopened", async () => {
    const big = noise(MEDIA_MAX_BYTES + 1);
    const bytes = buildZip([{ name: "data.json", data: "{}" }, { name: "big.jpg", data: big, method: 0 }]);
    const rules: EntryRule[] = [{ name: "data.json" }, { pattern: /^big[.]jpg$/, images: true }];
    await withZip(bytes, async (zip) => expect(zip.size("big.jpg")).toBe(MEDIA_MAX_BYTES + 1), { rules });
  });

  test("a data range outside the file, or two allowlisted entries whose ranges overlap, is unreadable", async () => {
    expect(await outcome([{ name: "a.json", data: noise(500), method: 0, declaredCompressed: 5_000_000, declaredSize: 5_000_000 }])).toBe("unreadable");
    expect(await outcome([{ name: "outer.json", data: noise(300), method: 0 }, { name: "inner.json", data: "{}", method: 0, nestInPrevious: true }])).toBe("unreadable");
    // The same two names without the overlap read.
    expect(await outcome([{ name: "outer.json", data: noise(300), method: 0 }, { name: "inner.json", data: "{}", method: 0 }])).toBe("ok");
  });
});

describe("step 5: opening an entry", () => {
  test("a local header whose name, method or encryption bit differs from the central entry is unreadable", async () => {
    expect(await outcome([{ name: "a.json", data: TEXT, localName: "b.json" }])).toBe("unreadable");
    expect(await outcome([{ name: "a.json", data: TEXT, localMethod: 0 }])).toBe("unreadable");
  });

  test("a size that lies stops one byte over the central size, and a bad CRC is found at the end", async () => {
    expect(await outcome([{ name: "a.json", data: TEXT, declaredSize: 100 }])).toBe("unreadable");
    expect(await outcome([{ name: "a.json", data: TEXT, badCrc: true }])).toBe("unreadable");
    expect(await outcome([{ name: "a.json", data: TEXT, badCrc: true, dataDescriptor: true }])).toBe("unreadable");
    expect(await outcome([{ name: "a.json", data: noise(400), method: 0, declaredSize: 300, declaredCompressed: 400 }])).toBe("unreadable");
  });

  test("a reader that stops early leaves nothing open, and the next read starts afresh", async () => {
    const big = noise(3_000_000);
    await withZip(buildZip([{ name: "a.bin", data: big, method: 0 }]), async (zip) => {
      for await (const chunk of zip.open("a.bin")) {
        expect(chunk.length).toBeGreaterThan(0);
        break;
      }
      expect((await readAll(zip, "a.bin")).equals(big)).toBe(true);
    });
  });
});
