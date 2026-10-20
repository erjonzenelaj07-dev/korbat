import { randomUUID } from "node:crypto";
import pino from "pino";
import { describe, expect, test } from "vitest";
import type { ResultFile } from "@korbat/media-protocol";
import { R1_TEST_MODEL } from "@korbat/media-protocol";
import type { MediaDeps } from "../../src/media/context";
import { finalize } from "../../src/media/flows/status";

/**
 * 3d review L3 (design, sections 5 and 7.9): finalize on a server whose R1 check is on (deps.r1Model set) and a ready result
 * of the worker that carries no score, as a worker left behind or set otherwise writes it: the image is ready all the same,
 * unscored, and a warning is logged, so the operator learns that the check scores nothing while the pages say it is on
 * (automation-status counts such uploads). No database: finalize's deps are stand-ins that record what it does.
 */
describe("finalize, a ready result without a score while the R1 check is on (3d review L3)", () => {
  function deps(r1Model: string | null, result: ResultFile) {
    const lines: Record<string, unknown>[] = [];
    const log = pino({ level: "warn" }, { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) });
    const stored: { id: string; score: number | null }[] = [];
    const d = {
      r1Model,
      log,
      match: { mode: "off" },
      files: { readResult: async () => result, discardUpload: async () => undefined },
      repo: { finalize: async (id: string, _result: ResultFile, score: number | null) => void stored.push({ id, score }) },
    } as unknown as MediaDeps;
    return { d, lines, stored };
  }
  const ready = (id: string, r1?: { model: string; score: number }): ResultFile => ({ v: 2, id, status: "ready", width: 8, height: 8, blurhash: "L2Eo_P_3jb_3~qoL", ...(r1 ? { r1 } : {}) });

  test("the image is stored unscored and a warning names the upload, never a score", async () => {
    const id = randomUUID();
    const { d, lines, stored } = deps(R1_TEST_MODEL, ready(id));
    expect(await finalize(d, id)).toBe(true);
    expect(stored).toEqual([{ id, score: null }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 40, id });
    expect(String(lines[0]!.msg)).toMatch(/no score while the R1 check is on/);
  });

  test("with a score of the server's own model, or with the check off, nothing is logged", async () => {
    const a = randomUUID();
    const scored = deps(R1_TEST_MODEL, ready(a, { model: R1_TEST_MODEL, score: 0.25 }));
    await finalize(scored.d, a);
    expect([scored.lines, scored.stored]).toEqual([[], [{ id: a, score: 0.25 }]]);
    const b = randomUUID();
    const off = deps(null, ready(b));
    await finalize(off.d, b);
    expect(off.lines).toEqual([]);
  });
});
