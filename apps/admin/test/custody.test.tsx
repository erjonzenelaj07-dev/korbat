import { QUARANTINE_RULES, type CaseDecision, type CaseView, type StaffOverview } from "@korbat/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CUSTODY_WORDS, RELEASE_WORDS } from "../src/messages";
import { parseCaseId } from "../src/router";
import { CaseScreenView, type CaseScreenViewProps } from "../src/screens/Case";
import { CustodyLines, OverviewView } from "../src/screens/Home";
import { bothTimes } from "../src/ui";
import { decision, frozenCase, NO_STANDING, overview } from "./case-fixtures";

/**
 * The quarantine on the console (3d design, sections 8.1, 8.2 and 8.4; Task 1), server-rendered: Home's [home.quarantine]
 * in the block "Sealed files and programs", with its addition once the oldest due move is older than the alert's
 * threshold; and a seal for good's custody on its case: [case.custody.in] with and without the files that are still in
 * the store, [case.custody.return], and [case.custody.lost] in its two forms. Every number comes from the answer or a
 * constant, and nothing names a file.
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
const NOW = new Date("2026-10-18T12:00:00.000Z").getTime();
const hoursBefore = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

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
const SEAL_ACTION = "e1f20314-2536-4849-9ab5-d0e1f2031425";
const SEAL_DECISION = "f2031425-3647-495a-8bc6-e1f203142536";

/** The frozen case with a seal for good, in force or lifted, whose custody is as given. */
function sealedCase(custody: CaseDecision["custody"], inForce = true): CaseView {
  const view = frozenCase();
  return {
    ...view,
    decisions: [
      ...view.decisions,
      decision({
        id: SEAL_DECISION,
        kind: "final",
        ruleId: "R2",
        category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
        suspect: true,
        needsAdmin: true,
        actions: [{ id: SEAL_ACTION, kind: "seal_media", mediaId: null, noEffect: null, inForce, reversesActionId: null, liftedBy: null, sealed: { posts: 1, images: 2, deletedPosts: 0, list: [] }, ...NO_STANDING }],
        ...(custody === undefined ? {} : { custody }),
      }),
    ],
  };
}
const page = (view: CaseView) => text(html(<CaseScreenView {...base} caseId={parseCaseId(view.id)!} view={view} />));

describe("Home's [home.quarantine] (3d design, section 8.2)", () => {
  const quarantined = (q: StaffOverview["quarantine"]) => overview({ quarantine: q });

  test("while a move is due: the counts and the oldest time, and from the alert's threshold the daily alert; nothing while none is", () => {
    const fresh = hoursBefore(2);
    const young = text(html(<CustodyLines overview={quarantined({ dueIn: 3, dueOut: 1, undestroyed: 0, oldest: fresh })} now={NOW} />));
    expect(young).toBe(`${CUSTODY_WORDS.homeTitle}${CUSTODY_WORDS.homeQuarantine(3, 1, bothTimes(fresh))}`);
    expect(young).toContain("Files to move or return: 3 images to move into the quarantine, 1 to return to the image store, the oldest due since");
    const old = hoursBefore(QUARANTINE_RULES.dueHours + 1);
    const late = text(html(<CustodyLines overview={quarantined({ dueIn: 0, dueOut: 2, undestroyed: 0, oldest: old })} now={NOW} />));
    expect(late).toBe(`${CUSTODY_WORDS.homeTitle}${CUSTODY_WORDS.homeQuarantine(0, 2, bothTimes(old))} ${CUSTODY_WORDS.homeQuarantineLate}`);
    expect(CUSTODY_WORDS.homeQuarantineLate).toBe(`More than ${QUARANTINE_RULES.dueHours} hours: every staff account is alerted daily until the move is recorded.`);
    expect(html(<CustodyLines overview={quarantined({ dueIn: 0, dueOut: 0, undestroyed: 0, oldest: null })} now={NOW} />)).toBe("");
    // 3d Task 2: released files to destroy have a line of their own, [home.undestroyed], whatever else is due.
    expect(text(html(<CustodyLines overview={quarantined({ dueIn: 0, dueOut: 0, undestroyed: 4, oldest: null })} now={NOW} />))).toBe(`${CUSTODY_WORDS.homeTitle}${RELEASE_WORDS.homeUndestroyed(4)}`);
    // The block stands below "Authorities", before the lanes.
    const home = text(html(<OverviewView overview={quarantined({ dueIn: 1, dueOut: 0, undestroyed: 0, oldest: fresh })} now={NOW} onOpenCase={noop} />));
    expect(home.indexOf(CUSTODY_WORDS.homeTitle)).toBeLessThan(home.indexOf("Cases"));
  });
});

describe("a seal for good's custody on its case (3d design, section 8.4)", () => {
  const movedAt = "2026-10-17T08:00:00.000Z";

  test("[case.custody.in]: not moved yet; some moved, the others still in the store; all moved", () => {
    expect(page(sealedCase({ files: 4, moved: 0, movedAt: null, toReturn: 0, filesLeft: 0, lost: 0 }))).toContain("Files: not moved to the quarantine yet.");
    const some = page(sealedCase({ files: 4, moved: 2, movedAt, toReturn: 0, filesLeft: 0, lost: 0 }));
    expect(some).toContain(`Files: 2 of 4 are in the quarantine, since ${bothTimes(movedAt)}. ${CUSTODY_WORDS.custodyInRest}`);
    const all = page(sealedCase({ files: 4, moved: 4, movedAt, toReturn: 0, filesLeft: 0, lost: 0 }));
    expect(all).toContain(`Files: 4 of 4 are in the quarantine, since ${bothTimes(movedAt)}.`);
    expect(all).not.toContain(CUSTODY_WORDS.custodyInRest);
    // A decision without custody shows none of it.
    expect(page(sealedCase(undefined))).not.toContain("Files:");
  });

  test("[case.custody.return] after the seal was lifted, and [case.custody.lost] in its form for a seal that stands and for one that was lifted", () => {
    const back = page(sealedCase({ files: 2, moved: 2, movedAt, toReturn: 2, filesLeft: 0, lost: 0 }, false));
    expect(back).toContain(
      "Files to return: the seal was lifted and 2 files of its images are still in the quarantine. The images are shown again once whoever has the server has returned them (the README, Quarantine).",
    );
    expect(back).not.toContain("are in the quarantine, since");
    const keptLost = page(sealedCase({ files: 4, moved: 2, movedAt, toReturn: 0, filesLeft: 0, lost: 2 }));
    expect(keptLost).toContain("Files lost: 2. They were found in neither the image store nor the quarantine and are recorded as lost; there is nothing to move, hand over or destroy for them.");
    // Two moved and two lost: every file is accounted for, so nothing is said of the store.
    expect(keptLost).not.toContain(CUSTODY_WORDS.custodyInRest);
    const liftedLost = page(sealedCase({ files: 2, moved: 0, movedAt: null, toReturn: 0, filesLeft: 0, lost: 2 }, false));
    // Review M12: korbat tells the author once the seal is lifted, unless the post is gone; it says no more than that.
    expect(liftedLost).toContain("Files lost: 2. Their images cannot be shown again. korbat tells their author so by mail, unless the post was deleted or erased.");
    expect(liftedLost).not.toContain("was told so");
    // Review M12: files to return beside a lost one: only the images whose files are all kept are shown again.
    const both = page(sealedCase({ files: 4, moved: 2, movedAt, toReturn: 2, filesLeft: 0, lost: 1 }, false));
    expect(both).toContain(
      "Files to return: the seal was lifted and 2 files of its images are still in the quarantine. The images whose files are all kept are shown again once whoever has the server has returned them (the README, Quarantine); an image with a lost file is not.",
    );
    for (const out of [back, keptLost, liftedLost, both]) expect(out).not.toMatch(/[.]webp|files[/]/);
  });
});
