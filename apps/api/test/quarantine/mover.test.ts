import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { MEDIA_SIZES, QUARANTINE_DIRECTIONS, QUARANTINE_WORDS } from "@korbat/contracts";
import { isStoredName as handoverIsStoredName, storedName as handoverStoredName } from "../../src/handover";
import { storedImageName } from "../../src/media";
import { MOVER_DIRECTIONS, MOVER_WORDS, isStoredName, parseQuarantineArgs, storedName } from "../../src/quarantine";
import { LF, custodyStore, sha256, type CustodyStore } from "./custody-store";

/**
 * The mover of the quarantine (3d design, sections 5 and 7.1; 12.1 row 13), as a unit, against custodyStore(): two
 * temporary directories laid out as the store and the quarantine, with harmless files that are not images. It never loses
 * or invents a file, a crash leaves a file in one place or in both, and one bad line never stops a run.
 */
describe("the quarantine's mover (3d Task 1)", () => {
  const stores: CustodyStore[] = [];
  const made = () => {
    const s = custodyStore();
    stores.push(s);
    return s;
  };
  afterEach(() => {
    for (const s of stores.splice(0)) s.remove();
  });
  const receipt = (direction: string, name: string, data: Buffer, word: string) => `${direction} ${name.split("/")[2]} ${name} ${data.length} ${sha256(data)} ${word}`;

  test("the store's naming rule in its three copies (the media module's, the hand-over's and the mover's) gives the same names, and the mover's words are the contracts'", () => {
    for (let i = 0; i < 200; i++) {
      const id = randomUUID();
      for (const size of MEDIA_SIZES) {
        const name = storedImageName(id, size);
        expect(storedName(id, size)).toBe(name);
        expect(handoverStoredName(id, size)).toBe(name);
        expect(isStoredName(name, id)).toBe(true);
        expect(handoverIsStoredName(name)).toBe(true);
        // A name of another image is outside the layout for this one.
        expect(isStoredName(name, randomUUID())).toBe(false);
      }
    }
    for (const outside of ["files/aa/../../etc/passwd", "/files/ab/x/small.webp", "files/ab/not-an-id/small.webp", `files/zz/${randomUUID()}/small.webp`, `files/${"a".repeat(2)}/${randomUUID()}/medium.webp`]) {
      expect(isStoredName(outside), outside).toBe(false);
    }
    expect([...MOVER_DIRECTIONS]).toEqual([...QUARANTINE_DIRECTIONS]);
    expect(MOVER_WORDS).toEqual({ move: [...QUARANTINE_WORDS.move], destroy: [...QUARANTINE_WORDS.destroy], have: QUARANTINE_WORDS.have });
  });

  test("in, then out: each file is copied, compared, renamed and only then unlinked, and the receipt names its bytes and digest", async () => {
    const s = made();
    const [a, b] = [randomUUID(), randomUUID()];
    const names = s.put([a, b]);
    const bytes = new Map(names.map((name) => [name, s.read(name, "store")]));
    const moved = await s.run(s.list("in", names));
    expect([moved.code, moved.errors]).toEqual([0, []]);
    expect(moved.lines).toEqual(names.map((name) => receipt("in", name, bytes.get(name)!, "done")));
    for (const name of names) expect(s.place(name), name).toBe("quarantine");
    // No temporary copy is left behind.
    expect(readdirSync(path.join(s.quarantine, ...names[0]!.split("/").slice(0, -1))).sort()).toEqual(["large.webp", "small.webp"]);

    const back = await s.run(s.list("out", names.slice(0, 2)));
    expect([back.code, back.lines]).toEqual([0, names.slice(0, 2).map((name) => receipt("out", name, bytes.get(name)!, "done"))]);
    for (const name of names.slice(0, 2)) {
      expect(s.place(name)).toBe("store");
      expect(s.read(name, "store")).toEqual(bytes.get(name));
    }
    for (const name of names.slice(2)) expect(s.place(name)).toBe("quarantine");
  });

  test("a crash after the copy and before the unlink leaves the file in both places, and the next run finishes it as already", async () => {
    const s = made();
    const names = s.put([randomUUID()]);
    const data = s.read(names[0]!, "store");
    await expect(
      s.run(s.list("in", names), [], {
        beforeUnlink: async () => {
          throw new Error("the host went down");
        },
      }),
    ).rejects.toThrow("the host went down");
    expect(s.place(names[0]!)).toBe("both");
    const again = await s.run(s.list("in", names));
    expect(again.code).toBe(0);
    expect(again.lines).toEqual([receipt("in", names[0]!, data, "already"), receipt("in", names[1]!, s.read(names[1]!, "quarantine"), "done")]);
    for (const name of names) expect(s.place(name)).toBe("quarantine");
  });

  test("a copy whose digest differs is removed and its source kept, a name outside the layout is skipped, and the lines after each are still done, with exit 1 at the end", async () => {
    const s = made();
    const [a, b] = [randomUUID(), randomUUID()];
    const [aSmall, aLarge, bSmall, bLarge] = s.put([a, b]);
    const forged = `files/${a.slice(0, 2)}/${a}/../../../../outside.webp`;
    const input = [`in ${a} ${aSmall}`, `in ${a} ${forged}`, `in ${b} ${aLarge}`, `in ${b} ${bSmall}`, "not a line at all", `in ${b} ${bLarge}`].join(LF);
    let writes = 0;
    const run = await s.run(input, [], {
      // The first copy is written with one byte changed, as a failing disk would.
      writeCopy: async (file, data) => {
        writes++;
        await file.writeFile(writes === 1 ? Buffer.concat([data.subarray(1), Buffer.from("!")]) : data);
      },
    });
    expect(run.code).toBe(1);
    expect(run.lines).toEqual([
      `in ${a} ${aSmall} refused`,
      `in ${a} ${forged} refused`,
      // The id the line names must be the file's own.
      `in ${b} ${aLarge} refused`,
      receipt("in", bSmall!, s.read(bSmall!, "quarantine"), "done"),
      receipt("in", bLarge!, s.read(bLarge!, "quarantine"), "done"),
    ]);
    expect(run.errors).toEqual([
      `quarantine: ${aSmall}: the copy's digest differs; the copy is removed and the source kept`,
      `quarantine: skipped: ${forged} is outside the layout`,
      `quarantine: skipped: ${aLarge} is outside the layout`,
      "quarantine: line 5 is not a line of quarantine-list; skipped",
    ]);
    expect(s.place(aSmall!)).toBe("store");
    expect(readdirSync(path.join(s.quarantine, ...aSmall!.split("/").slice(0, -1)))).toEqual([]);
    expect(s.place(aLarge!)).toBe("store");
  });

  test("a file in neither place prints missing and the run goes on; only with --lost does it print lost", async () => {
    const s = made();
    const [gone, here] = [randomUUID(), randomUUID()];
    const goneNames = [storedName(gone, "small"), storedName(gone, "large")];
    const names = s.put([here]);
    const input = s.list("in", [goneNames[0]!, ...names]);
    const first = await s.run(input);
    expect(first.code).toBe(1);
    expect(first.lines).toEqual([`in ${gone} ${goneNames[0]} missing`, ...names.map((name) => receipt("in", name, s.read(name, "quarantine"), "done"))]);
    const lost = await s.run(s.list("out", goneNames), ["--lost"]);
    expect([lost.code, lost.lines]).toEqual([0, goneNames.map((name) => `out ${gone} ${name} lost`)]);
  });

  test("destroy takes the digest before the unlink, removes the file in the quarantine and in the store, and prints where it found it", async () => {
    const s = made();
    const [q, st, both, none] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    s.put([q], "quarantine");
    s.put([st], "store");
    s.put([both], "store");
    s.put([both], "quarantine");
    const names = [storedName(q, "small"), storedName(st, "small"), storedName(both, "large"), storedName(none, "small")];
    const before = names.slice(0, 3).map((name) => (s.place(name) === "store" ? s.read(name, "store") : s.read(name, "quarantine")));
    const run = await s.run(s.list("destroy", names));
    expect(run.code).toBe(0);
    expect(run.lines).toEqual([
      receipt("destroy", names[0]!, before[0]!, "quarantine"),
      receipt("destroy", names[1]!, before[1]!, "store"),
      receipt("destroy", names[2]!, before[2]!, "both"),
      `destroy ${none} ${names[3]} already`,
    ]);
    for (const name of names) expect(s.place(name), name).toBe("neither");
    // The other size of each image is left alone: a destroy line names one file.
    expect(s.place(storedName(q, "large"))).toBe("quarantine");
  });

  test("an operator line is left alone, and --inventory prints every file the quarantine holds and moves none", async () => {
    const s = made();
    const [a, b] = [randomUUID(), randomUUID()];
    const names = s.put([a, b], "quarantine");
    const op = await s.run(s.list("operator", [names[0]!]));
    expect([op.code, op.lines, op.errors]).toEqual([0, [], [`quarantine: ${names[0]} is an operator line; left alone (the README, Restoring)`]]);
    // A file of another kind in the quarantine is reported for the operator and left where it is.
    s.write(`files/${a.slice(0, 2)}/${a}/notes.txt`, "quarantine", Buffer.from("x"));
    const have = await s.run("in whatever the list says", ["--inventory"]);
    expect(have.code).toBe(1);
    expect(have.lines.sort()).toEqual(names.map((name) => `have ${name.split("/")[2]} ${name} ${s.read(name, "quarantine").length} ${sha256(s.read(name, "quarantine"))}`).sort());
    expect(have.errors).toEqual([`quarantine: files/${a.slice(0, 2)}/${a}/notes.txt is outside the layout; left where it is`]);
    for (const name of names) expect(s.place(name)).toBe("quarantine");
  });

  test("the program refuses to start without its two roots, with a root that is no directory, or with any other flag", async () => {
    const s = made();
    expect(parseQuarantineArgs([])).toEqual({ problem: "quarantine: refused: name the image store's root and the quarantine's root, in that order" });
    expect(parseQuarantineArgs([s.store])).toHaveProperty("problem");
    expect(parseQuarantineArgs([s.store, s.quarantine, "--lost", "--inventory"])).toHaveProperty("problem");
    expect(parseQuarantineArgs([s.store, s.quarantine, "--force"])).toHaveProperty("problem");
    expect(parseQuarantineArgs([s.store, s.quarantine, "--lost"])).toEqual({ store: s.store, quarantine: s.quarantine, lost: true, inventory: false });
    const { main } = await import("../../src/quarantine");
    const errors: string[] = [];
    const io = { log: () => undefined, error: (line: string) => errors.push(line), input: async () => "" };
    expect(await main([s.store], io)).toBe(2);
    expect(await main([s.store, path.join(s.root, "not-mounted")], io)).toBe(2);
    expect(errors.at(-1)).toBe(`quarantine: refused: ${path.join(s.root, "not-mounted")} is not a directory`);
  });

  test("the directory's sync is skipped only where the platform refuses it (EPERM); any other error ends the run with every file in one place or in both", async () => {
    const s = made();
    const names = s.put([randomUUID(), randomUUID()]);
    const refused = await s.run(s.list("in", names.slice(0, 2)), [], {
      syncDirectory: async () => {
        throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
      },
    });
    // The program's own sync takes EPERM as the platform's refusal; a hook stands for the sync itself, so EPERM from it
    // is a failure like any other: only the program's default skips it.
    expect(refused.code).toBe(1);
    expect(refused.errors[0]).toMatch(/the directory could not be synced [(]EPERM[)]; the run stops here/);
    const failing = await s.run(s.list("in", names.slice(2)), [], {
      syncDirectory: async () => {
        throw Object.assign(new Error("i/o error"), { code: "EIO" });
      },
    });
    expect(failing.code).toBe(1);
    expect(failing.lines).toEqual([]);
    expect(failing.errors).toEqual([expect.stringMatching(/the directory could not be synced [(]EIO[)]; the run stops here, and every file is in one place or in both$/)]);
    // The first file was renamed into place before the sync failed, and its source was kept; the second was not touched.
    expect(s.place(names[2]!)).toBe("both");
    expect(s.place(names[3]!)).toBe("store");
    // The program's own sync, on this platform, either syncs or meets EPERM and goes on.
    const plain = await s.run(s.list("in", names));
    expect(plain.code).toBe(0);
    for (const name of names) expect(s.place(name)).toBe("quarantine");
  });
});
