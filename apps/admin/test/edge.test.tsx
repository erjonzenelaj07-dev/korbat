import { EDGE_WORDS, type CaseView, type EdgePurgeView } from "@korbat/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AUTOMATION_WORDS } from "../src/messages";
import { parseCaseId } from "../src/router";
import { CaseScreenView, type CaseScreenViewProps } from "../src/screens/Case";
import { bothTimes } from "../src/ui";
import { IMAGE_ONE, IMAGE_TWO, postCase, postSnapshot } from "./case-fixtures";

/**
 * The edge's purge lines on a case (3d design, sections 8.1, 8.4 and 10.3; Task 3), server-rendered: beside each image
 * of the newest snapshot that stopped being public, [case.purge.accepted] with its time, [case.purge.failed],
 * [case.purge.off] and [case.purge.pending], each the minutes of the edge's bound from EDGE_WORDS, never typed; nothing
 * beside an image that never stopped being public, and nothing for a snapshot that is withheld.
 */
const html = (element: ReactElement): string => renderToStaticMarkup(element);
const text = (out: string) =>
  out
    .replace(/<[^>]+>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
const noop = () => undefined;
const base: Omit<CaseScreenViewProps, "caseId" | "view"> = {
  shownImage: null,
  busy: null,
  notice: null,
  error: null,
  note: "",
  reveal: null,
  onOpenCase: noop,
  onShowImage: noop,
  onShowClearly: noop,
  onHideImage: noop,
  onImageError: noop,
  onSnapshot: noop,
  onNoteChange: noop,
  onNoteSave: noop,
  onRevealOpen: noop,
  onRevealChange: noop,
  onRevealConfirm: noop,
  onRevealClose: noop,
};
const IMAGE_THREE = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const IMAGE_FOUR = "3d4e5f6a-7b8c-4d9e-8f0a-2b3c4d5e6f7a";
const AT = "2026-10-19T09:15:00.000Z";
const page = (view: CaseView) => html(<CaseScreenView {...base} caseId={parseCaseId(view.id)!} view={view} />);

/** The post's case whose newest snapshot lists four images, with these purge lines. */
function withPurges(purges: EdgePurgeView[]): CaseView {
  const four = postSnapshot({
    media: [
      { id: IMAGE_ONE, alt: "one", width: 2048, height: 1536 },
      { id: IMAGE_TWO, alt: "two", width: 800, height: 600 },
      { id: IMAGE_THREE, alt: "three", width: 640, height: 480 },
      { id: IMAGE_FOUR, alt: "four", width: 320, height: 240 },
    ],
  });
  return postCase({ snapshots: [four], purges });
}

describe("[case.purge.*] beside each image that stopped being public (3d design, section 8.4)", () => {
  test("the four words, from the outcome, the answer's time and EDGE_WORDS", () => {
    expect(AUTOMATION_WORDS.purge("accepted", bothTimes(AT))).toBe(`Edge copy: purge accepted at ${bothTimes(AT)}.`);
    expect(AUTOMATION_WORDS.purge("failed", bothTimes(AT))).toBe(
      `Edge copy: purge failed. A copy may have been served for up to ${EDGE_WORDS.edgeMinutes} minutes after the measure; the operator is alerted.`,
    );
    expect(AUTOMATION_WORDS.purge("off", bothTimes(AT))).toBe(`Edge copy: no purge (off): a copy may be served for up to ${EDGE_WORDS.edgeMinutes} minutes.`);
    expect(AUTOMATION_WORDS.purge("pending", bothTimes(AT))).toBe("Edge copy: purge not sent yet.");
    // The minutes are the constant's, which the header is built from: five while EDGE_CACHE.edgeSeconds is 300.
    expect(AUTOMATION_WORDS.purge("off", "x")).toContain("up to 5 minutes");
  });

  test("each image of the newest snapshot gets its own line, in the image's place, and an image with no row gets none", () => {
    const out = page(
      withPurges([
        { mediaId: IMAGE_ONE, outcome: "accepted", at: AT },
        { mediaId: IMAGE_TWO, outcome: "failed", at: AT },
        { mediaId: IMAGE_THREE, outcome: "off", at: AT },
      ]),
    );
    const shown = text(out);
    const lines = [AUTOMATION_WORDS.purge("accepted", bothTimes(AT)), AUTOMATION_WORDS.purge("failed", bothTimes(AT)), AUTOMATION_WORDS.purge("off", bothTimes(AT))];
    for (const line of lines) expect(shown.split(line).length - 1, line).toBe(1);
    expect(shown).not.toContain(AUTOMATION_WORDS.purge("pending", bothTimes(AT)));
    // In the images' order: each line follows its image's size and comes before the next image.
    const at = (part: string) => shown.indexOf(part);
    expect(at("2048 by 1536 pixels")).toBeLessThan(at(lines[0]!));
    expect(at(lines[0]!)).toBeLessThan(at("800 by 600 pixels"));
    expect(at("800 by 600 pixels")).toBeLessThan(at(lines[1]!));
    expect(at(lines[1]!)).toBeLessThan(at("640 by 480 pixels"));
    expect(at(lines[2]!)).toBeLessThan(at("320 by 240 pixels"));
    expect(shown.split("Edge copy:").length - 1).toBe(3);
    // A failure is drawn as a notice; the other lines as hints.
    expect(out).toContain(`<p class="purge notice">${AUTOMATION_WORDS.purge("failed", bothTimes(AT))}</p>`);
    expect(out).toContain(`<p class="purge hint">${AUTOMATION_WORDS.purge("off", bothTimes(AT))}</p>`);
  });

  test("pending while the row has no outcome; nothing at all while no image stopped being public, or while the snapshot is withheld", () => {
    expect(text(page(withPurges([{ mediaId: IMAGE_FOUR, outcome: "pending", at: AT }])))).toContain("Edge copy: purge not sent yet.");
    expect(text(page(withPurges([])))).not.toContain("Edge copy:");
    const withheld = { ...withPurges([{ mediaId: IMAGE_ONE, outcome: "accepted", at: AT }]), snapshots: [{ id: postSnapshot().id, takenAt: AT, digest: "a".repeat(64), withheld: true as const }] };
    expect(text(page(withheld as CaseView))).not.toContain("Edge copy:");
  });
});
