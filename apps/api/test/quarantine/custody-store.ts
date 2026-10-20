import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MEDIA_SIZES } from "@korbat/contracts";
import { main, runQuarantine, storedName, type QuarantineOptions } from "../../src/quarantine";

export const LF = String.fromCharCode(10);
export const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** What one run of the mover printed and answered. */
export interface MoverRun {
  code: number;
  /** Standard output: the receipt. */
  lines: string[];
  /** Standard error: what the operator reads. */
  errors: string[];
}

/**
 * The fixture of 3d's section 12, `custodyStore()` (Task 1): two temporary directories laid out as the image store and the
 * quarantine, filled with harmless files that are not images (a few bytes of text under the store's names), and a runner
 * of the mover's program on a list, which passes the two roots as the program's two arguments, as the Compose service's
 * command does. `remove()` deletes both.
 */
export function custodyStore() {
  const root = mkdtempSync(path.join(tmpdir(), "korbat-custody-"));
  const store = path.join(root, "store");
  const quarantine = path.join(root, "quarantine");
  mkdirSync(store, { recursive: true });
  mkdirSync(quarantine, { recursive: true });
  const at = (base: string, name: string) => path.join(base, ...name.split("/"));

  /** The bytes a fixture writes for one stored file: text, never an image. */
  const bytesOf = (name: string) => Buffer.from(`not an image: ${name} ${"x".repeat(name.endsWith("large.webp") ? 300 : 40)}`, "utf8");

  return {
    root,
    store,
    quarantine,
    /** Writes both sizes of these images under one root (the store unless said), and answers their names. */
    put(ids: readonly string[], where: "store" | "quarantine" = "store"): string[] {
      const names: string[] = [];
      for (const id of ids) {
        for (const size of MEDIA_SIZES) {
          const name = storedName(id, size);
          const file = at(where === "store" ? store : quarantine, name);
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, bytesOf(name));
          names.push(name);
        }
      }
      return names;
    },
    /** Writes other bytes at a name, under one root. */
    write(name: string, where: "store" | "quarantine", data: Buffer): void {
      const file = at(where === "store" ? store : quarantine, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, data);
    },
    bytesOf,
    /** Whether a name is in the store, in the quarantine, in both or in neither. */
    place(name: string): "store" | "quarantine" | "both" | "neither" {
      const s = existsSync(at(store, name));
      const q = existsSync(at(quarantine, name));
      return s && q ? "both" : s ? "store" : q ? "quarantine" : "neither";
    },
    read(name: string, where: "store" | "quarantine"): Buffer {
      return readFileSync(at(where === "store" ? store : quarantine, name));
    },
    /** One list line for each name, in the direction given: "<direction> <id> <file>". */
    list(direction: string, names: readonly string[]): string {
      return names.map((name) => `${direction} ${name.split("/")[2]} ${name}`).join(LF) + LF;
    },
    /**
     * Runs the program as the service does, with the two roots as its arguments and the flags after them, on the list as
     * its standard input; the hooks of QuarantineOptions are for the tests that make a step fail.
     */
    async run(input: string, flags: readonly string[] = [], hooks: Pick<QuarantineOptions, "writeCopy" | "syncDirectory" | "beforeUnlink"> = {}): Promise<MoverRun> {
      const lines: string[] = [];
      const errors: string[] = [];
      const io = { log: (line: string) => lines.push(line), error: (line: string) => errors.push(line), input: async () => input };
      const code = Object.keys(hooks).length === 0 ? await main([store, quarantine, ...flags], io) : await runWithHooks(store, quarantine, input, flags, io, hooks);
      return { code, lines, errors };
    },
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** The same run below main, so that a test can hand the program a failing step. */
function runWithHooks(
  store: string,
  quarantine: string,
  input: string,
  flags: readonly string[],
  io: { log: (line: string) => void; error: (line: string) => void },
  hooks: Pick<QuarantineOptions, "writeCopy" | "syncDirectory" | "beforeUnlink">,
): Promise<number> {
  return runQuarantine({ store, quarantine, input, lost: flags.includes("--lost"), inventory: flags.includes("--inventory"), log: io.log, error: io.error, ...hooks });
}

export type CustodyStore = ReturnType<typeof custodyStore>;
