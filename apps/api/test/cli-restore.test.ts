import { describe, expect, test } from "vitest";
import { decisionClass, parseRestoreArgs, readTail, walkTail } from "../src/cli/restore";
import { parseStaffArgs } from "../src/cli/staff";
import { CHAIN_ZERO_HASH, canonicalText, chainHash } from "../src/staff";

/**
 * restore-import's reading of the keeper's files, without a database (3f design, sections 7.17 step 2.1 and 8.11): each
 * line's hash recomputes from its own members with the chain's canonical text; the lines at or below the restored head
 * are checked, the run above it must continue the head, a changed line refuses everything and a hole ends the run. And
 * the class a lost decision's gap gets (6.6).
 */
const LF = String.fromCharCode(10);
const AT = "2026-10-10T01:00:00.123Z";

/** A chain of lines from place 1, each hashed as the trigger hashes a row, as AuditExportLine JSON. */
function chain(n: number, action = "probe"): string[] {
  const lines: string[] = [];
  let prev = CHAIN_ZERO_HASH;
  for (let place = 1; place <= n; place++) {
    const row = {
      chainVersion: 1,
      chainSeq: place,
      id: place,
      createdAt: new Date(AT),
      actorId: "00000000-0000-0000-0000-000000000000",
      action,
      targetType: null,
      targetId: null,
      requestId: null,
      staffSession: null,
      keyId: null,
      actionHash: null,
      stepUpText: null,
      metadataText: `{"n": ${place}}`,
    };
    const hash = chainHash(prev, canonicalText(row));
    lines.push(
      JSON.stringify({
        v: 1,
        place,
        id: place,
        at: AT,
        actor: row.actorId,
        action: row.action,
        targetType: null,
        targetId: null,
        requestId: null,
        staffSession: null,
        keyId: null,
        actionHash: null,
        stepUp: null,
        metadata: row.metadataText,
        prevHash: prev,
        hash,
      }),
    );
    prev = hash;
  }
  return lines;
}
const input = (lines: readonly string[]) => Buffer.from(lines.join(LF) + LF, "utf8");
const hashAt = (lines: readonly string[], place: number) => (JSON.parse(lines[place - 1]!) as { hash: string }).hash;
const refusal = /^restore-import: refused: line [0-9]+ does not continue the restored head /;

describe("restore-import's walk of the keeper's files", () => {
  const all = chain(12);
  const head = { seq: 8, hash: hashAt(all, 8) };

  test("files that start before the head: the earlier lines checked, the run from the head's next place imported", () => {
    const walked = walkTail(readTail(input(all.slice(2)), head), head, [{ seq: 5, hash: hashAt(all, 5) }]);
    expect(walked.checked).toBe(6);
    expect(walked.run.map((entry) => entry.line.place)).toEqual([9, 10, 11, 12]);
    expect(walked.hole).toBeNull();
    // Two downloads that overlap repeat lines; each is read once.
    expect(walkTail(readTail(input([...all.slice(2, 10), ...all.slice(8)]), head), head, []).run.map((entry) => entry.line.place)).toEqual([9, 10, 11, 12]);
  });

  test("a hole ends the run and is reported; a file that begins above the head's next place is refused", () => {
    const holed = [...all.slice(0, 9), ...all.slice(10)];
    const walked = walkTail(readTail(input(holed), head), head, []);
    expect(walked.run.map((entry) => entry.line.place)).toEqual([9]);
    expect(walked.hole).toEqual({ after: 9, before: 11 });
    expect(() => walkTail(readTail(input(all.slice(9)), head), head, [])).toThrow(refusal);
  });

  test("a changed file refuses everything: a line that does not recompute, another hash at the head's place or at a kept place, a line naming another", () => {
    const changed = all.map((line, i) => (i === 9 ? line.replace('"action":"probe"', '"action":"other"') : line));
    expect(() => readTail(input(changed), head)).toThrow(refusal);
    expect(() => walkTail(readTail(input(all), { seq: 8, hash: "e".repeat(64) }), { seq: 8, hash: "e".repeat(64) }, [])).toThrow(refusal);
    expect(() => walkTail(readTail(input(all), head), head, [{ seq: 3, hash: "f".repeat(64) }])).toThrow(refusal);
    // A line that does not parse, or a time that does not print back as written.
    expect(() => readTail(input([...all.slice(0, 3), "{"]), head)).toThrow(refusal);
    expect(() => readTail(input([all[0]!.replace(AT, "2026-10-10T01:00:00.1230Z")]), head)).toThrow(refusal);
    // A tail of another chain: each line recomputes, but the first above the head names another predecessor.
    const other = chain(12, "other");
    expect(() => walkTail(readTail(input(other), head), head, [])).toThrow(refusal);
  });

  test("the class of a lost decision: a seal by the decision's kind, then a suspension or termination, another measure, a reversal, none", () => {
    expect(decisionClass({ kind: "final", actions: [{ kind: "seal_media" }, { kind: "remove" }] })).toBe("seal_final");
    expect(decisionClass({ kind: "interim", actions: [{ kind: "seal_media" }] })).toBe("seal_interim");
    expect(decisionClass({ kind: "final", actions: [{ kind: "suspend" }] })).toBe("standing");
    expect(decisionClass({ kind: "final", actions: [{ kind: "remove" }, { kind: "strike" }] })).toBe("restriction");
    expect(decisionClass({ kind: "correction", actions: [{ kind: "restore" }] })).toBe("reversal");
    expect(decisionClass({ kind: "final", actions: [] })).toBe("no_measure");
  });

  test("the commands' words: kept places, and --after a place", () => {
    expect(parseRestoreArgs("restore-import", [`7:${"a".repeat(64)}`])).toEqual({ command: "restore-import", kept: [{ seq: 7, hash: "a".repeat(64) }] });
    expect(() => parseRestoreArgs("restore-import", ["7:xyz"])).toThrow(/not a kept place/);
    expect(parseRestoreArgs("audit-export", [])).toEqual({ command: "audit-export", after: null });
    expect(parseRestoreArgs("audit-export", ["--after", "40"])).toEqual({ command: "audit-export", after: 40 });
    expect(() => parseRestoreArgs("audit-export", ["--after", "-1"])).toThrow(/--after/);
    expect(parseStaffArgs(["restore-import"])).toEqual({ command: "restore", restore: { command: "restore-import", kept: [] } });
  });
});
