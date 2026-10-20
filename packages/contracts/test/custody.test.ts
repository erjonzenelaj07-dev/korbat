import { describe, expect, test } from "vitest";
import {
  ALERT_KINDS,
  CaseDecision,
  MediaStatusResponse,
  QUARANTINE_DIRECTIONS,
  QUARANTINE_RULES,
  QUARANTINE_WORDS,
  QuarantineCounts,
  SealCustody,
  StaffOverview,
  renderAlert,
} from "../src/index";

/**
 * 3d Task 1, the quarantine (design, sections 6.1, 7.1, 8.1, 10.1 to 10.3 and W.7): the home screen's counts, a seal's
 * custody, the owner's status of an image being restored or lost, the words of the mover's receipt, and the two alerts.
 * Every answer holds counts, times and booleans, never a file's name or digest.
 */
describe("the quarantine's contracts (3d Task 1)", () => {
  const now = new Date("2026-10-18T12:00:00.000Z");

  test("StaffOverview carries the four values of quarantine_counts() and nothing else", () => {
    expect(Object.keys(StaffOverview.shape.quarantine.shape).sort()).toEqual(["dueIn", "dueOut", "oldest", "undestroyed"]);
    expect(QuarantineCounts.parse({ dueIn: 2, dueOut: 0, undestroyed: 1, oldest: "2026-10-17T08:00:00.000Z" })).toEqual({ dueIn: 2, dueOut: 0, undestroyed: 1, oldest: "2026-10-17T08:00:00.000Z" });
    expect(QuarantineCounts.parse({ dueIn: 0, dueOut: 0, undestroyed: 0, oldest: null }).oldest).toBeNull();
    expect(QuarantineCounts.safeParse({ dueIn: -1, dueOut: 0, undestroyed: 0, oldest: null }).success).toBe(false);
  });

  test("a seal's custody is six counts and one time, and only a decision may carry it", () => {
    expect(Object.keys(SealCustody.shape).sort()).toEqual(["files", "filesLeft", "lost", "moved", "movedAt", "toReturn"]);
    const custody = { files: 4, moved: 2, movedAt: "2026-10-17T08:00:00.000Z", toReturn: 0, filesLeft: 0, lost: 0 };
    expect(SealCustody.parse(custody)).toEqual(custody);
    expect(SealCustody.safeParse({ ...custody, movedAt: "yesterday" }).success).toBe(false);
    expect(CaseDecision.shape.custody.safeParse(undefined).success).toBe(true);
    expect(CaseDecision.shape.custody.safeParse(custody).success).toBe(true);
  });

  test("the owner's status of a ready image says restoring or lost, never both, and never for another status", () => {
    const ready = { id: "6f0c7c55-4f0e-4b8e-9d55-0c1d0f6c2b10", status: "ready", width: 10, height: 10, blurhash: "L2Eo_P_3jb_3~qoL" } as const;
    expect(MediaStatusResponse.parse({ ...ready, restoring: true })).toEqual({ ...ready, restoring: true });
    expect(MediaStatusResponse.parse({ ...ready, lost: true })).toEqual({ ...ready, lost: true });
    expect(MediaStatusResponse.safeParse({ ...ready, restoring: true, lost: true }).success).toBe(false);
    expect(MediaStatusResponse.safeParse({ ...ready, restoring: false }).success).toBe(false);
    expect(MediaStatusResponse.parse({ id: ready.id, status: "processing", restoring: true })).toEqual({ id: ready.id, status: "processing" });
  });

  test("the directions of the list and the words of the receipt are section 10.1's closed lists", () => {
    expect([...QUARANTINE_DIRECTIONS]).toEqual(["in", "out", "destroy", "operator"]);
    expect([...QUARANTINE_WORDS.move]).toEqual(["done", "already", "missing", "lost", "refused"]);
    expect([...QUARANTINE_WORDS.destroy]).toEqual(["quarantine", "store", "both", "already", "refused"]);
    expect(QUARANTINE_WORDS.have).toBe("have");
  });

  test("quarantine_due and quarantine_lost: a push and a sentence to every staff account, as W.7 words them", () => {
    expect(ALERT_KINDS.quarantine_due).toMatchObject({ priority: 3, scope: "all", legs: ["push", "mail"], mail: "sentence", facts: ["count", "oldestAt"] });
    expect(ALERT_KINDS.quarantine_lost).toMatchObject({ priority: 3, scope: "all", legs: ["push", "mail"], mail: "sentence", facts: ["count", "at"] });
    expect(renderAlert("quarantine_due", { count: 3, oldestAt: "2026-10-17T08:05:00.000Z" }, now)).toEqual({
      title: "Sealed files are waiting to be moved",
      sentence: `3 images have waited more than ${QUARANTINE_RULES.dueHours} hours to be moved into the quarantine or back, the oldest since 2026-10-17 08:05 UTC.`,
      todo: "Whoever has the server runs the README's steps under Quarantine. This repeats daily until the move is recorded.",
    });
    expect(QUARANTINE_RULES.dueHours).toBe(24);
    expect(renderAlert("quarantine_lost", { count: 2, at: "2026-10-18T11:40:00.000Z" }, now)).toEqual({
      title: "Sealed files are lost",
      sentence: "2 files that were to be kept apart are recorded as lost at 11:40 UTC: they are in neither the image store nor the quarantine.",
      // Review M12: true whether the seal stands now or is lifted later.
      todo: "Whoever has the server reads the README's section Quarantine, on a file in neither place. An image whose seal is lifted, now or later, cannot be shown again, and its author is then told by mail; a file kept for an authority cannot be handed over, and the operator tells the authority.",
    });
  });
});
