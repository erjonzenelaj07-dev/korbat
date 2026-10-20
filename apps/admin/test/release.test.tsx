import { RELEASE_POSTS_MAX, RETENTION, type AppealRow, type CaseDecision, type CaseView, type RestoreGap, type RestoreView, type SealRelease } from "@korbat/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CONSOLE_MODERATION_CODES, MODERATION_MESSAGES, RECOVERY_WORDS, RELEASE_WORDS } from "../src/messages";
import { parseCaseId } from "../src/router";
import { AppealsView } from "../src/screens/Appeals";
import { CaseScreenView, releaseParams, type CaseScreenViewProps, type ReleaseProps } from "../src/screens/Case";
import { CustodyLines } from "../src/screens/Home";
import { RestoreScreen } from "../src/screens/Restore";
import { releaseAction } from "../src/step-up";
import { bothTimes, dateTime } from "../src/ui";
import { decision, frozenCase, NO_STANDING, overview } from "./case-fixtures";

/**
 * The release on the console (3d design, sections 7.2, 8.2, 8.5, 8.7 and 8.8; Task 2), server-rendered: the block
 * "Release" under a seal for good in force, in each state of 8.9's Task 2 row (a recorded leave with the control; the
 * answer illegal without a leave, with [release.assessed] and no control; not_illegal, no_assessment and no answer
 * without it; a leave beside not_illegal with [release.conflict]; more posts than one release names, with [release.more];
 * greyed for a moderator; "The author may be told" in each of its three values; [release.done] once released), the params
 * the key signs, Appeals' [appeals.released], Home's two lines, After a restore's class release without a control, and
 * the words of each code. Every number is printed from the answer or a constant.
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
const SEAL_ACTION = "e1f20314-2536-4849-9ab5-d0e1f2031425";
const SEAL_DECISION = "f2031425-3647-495a-8bc6-e1f203142536";
const POST = "a1b2c3d4-0000-4000-8000-000000000001";
const LEAVE = "a1b2c3d4-0000-4000-8000-0000000000aa";

/** A release block as the API answers it for a seal reported, assessed illegal, moved, with a leave from a court. */
function block(overrides: Partial<SealRelease> = {}): SealRelease {
  return {
    reported: true,
    theirReference: "ST 12/34",
    answer: "illegal",
    answeredAt: "2026-10-12T00:00:00.000Z",
    handedOverAt: null,
    quarantined: true,
    preserved: false,
    leave: { id: LEAVE, from: "court", reference: "4 O 1/26", receivedOn: "2026-10-15", untold: false, untoldUntil: null },
    tellHeld: false,
    postIds: [POST],
    remaining: 0,
    silenceDays: null,
    releasedAt: null,
    basis: null,
    backupsClearAt: null,
    noticeHeld: null,
    releasedPosts: 0,
    releasedImages: 0,
    ...overrides,
  };
}

/** The frozen case with a seal for good in force whose decision carries this release block. */
function sealedCase(release: SealRelease, custody: CaseDecision["custody"] = { files: 4, moved: 4, movedAt: "2026-10-16T08:00:00.000Z", toReturn: 0, filesLeft: 0, lost: 0 }): CaseView {
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
        actions: [{ id: SEAL_ACTION, kind: "seal_media", mediaId: null, noEffect: null, inForce: true, reversesActionId: null, liftedBy: null, sealed: { posts: 1, images: 2, deletedPosts: 0, list: [] }, ...NO_STANDING }],
        custody,
        release,
      }),
    ],
  };
}
const as = (role: "admin" | "moderator"): ReleaseProps => ({ role, busy: false, error: null, onRelease: noop });
const markup = (view: CaseView, release: ReleaseProps = as("admin")) => html(<CaseScreenView {...base} caseId={parseCaseId(view.id)!} view={view} release={release} />);
const page = (view: CaseView, release: ReleaseProps = as("admin")) => text(markup(view, release));
const W = RELEASE_WORDS;

describe("the release block (3d design, section 8.5)", () => {
  test("a recorded leave: the facts, the words, the ground and the one control, for an admin", () => {
    const shown = page(sealedCase(block()));
    for (const label of [W.facts.reported.label, W.facts.answer.label, W.facts.leave.label, W.facts.tell.label, W.facts.quarantined.label, W.facts.preserved.label]) expect(shown).toContain(label);
    expect(shown).toContain("4 O 1/26");
    expect(shown).toContain("ST 12/34");
    expect(shown).toContain(W.what);
    expect(shown).toContain(W.tells);
    expect(shown).toContain(W.backups(RETENTION.backupDays));
    expect(shown).toContain(W.periodUnset);
    expect(shown).toContain(W.leave("from a court"));
    expect(shown).toContain(W.sign(1));
    expect(shown).toContain(W.button);
    expect(shown).not.toContain(W.assessed);
    expect(markup(sealedCase(block()))).toMatch(/<button type="button"[^>]*>Release and destroy<[/]button>/);
    expect(markup(sealedCase(block()))).not.toMatch(/<button type="button" disabled=""[^>]*>Release and destroy/);
    // The references are an outsider's text: drawn in a frame that says whose words they are.
    expect(shown).toContain("As recorded from the authority");
  });

  test("no leave: the answer illegal is [release.assessed] and every other answer, or none, [release.nothing]; neither offers a control", () => {
    const assessed = page(sealedCase(block({ leave: null })));
    expect(assessed).toContain(W.assessed);
    expect(assessed).not.toContain(W.button);
    expect(page(sealedCase(block({ leave: null, answer: "not_illegal" })))).toContain(W.notIllegal);
    for (const answer of ["no_assessment", "other", null] as const) {
      const shown = page(sealedCase(block({ leave: null, answer, answeredAt: answer === null ? null : "2026-10-12T00:00:00.000Z" })));
      expect(shown, String(answer)).toContain(W.nothing);
      expect(shown, String(answer)).not.toContain(W.button);
    }
    expect(page(sealedCase(block({ leave: null, answer: null, answeredAt: null })))).toContain(`${W.facts.answer.label}${W.facts.answer.none}`);
  });

  test("a leave beside the answer not_illegal: [release.conflict] above the control", () => {
    const shown = page(sealedCase(block({ answer: "not_illegal" })));
    expect(shown).toContain(W.conflict);
    expect(shown).toContain(W.button);
    expect(shown.indexOf(W.conflict)).toBeLessThan(shown.indexOf(W.button));
  });

  test("more posts than one release names: [release.more] with the constant and the count", () => {
    expect(page(sealedCase(block({ remaining: 3 })))).toContain(W.more(RELEASE_POSTS_MAX, 3));
    expect(W.more(RELEASE_POSTS_MAX, 3)).toContain(`the first ${RELEASE_POSTS_MAX} of them`);
  });

  test("greyed for a moderator, with admin_required's words, and the control disabled", () => {
    const shown = page(sealedCase(block()), as("moderator"));
    expect(shown).toContain(W.adminOnly);
    expect(markup(sealedCase(block()), as("moderator"))).toMatch(/<button type="button" disabled=""[^>]*>Release and destroy/);
  });

  test('"The author may be told" in each of its three values', () => {
    expect(page(sealedCase(block()))).toContain(`${W.facts.tell.label}${W.facts.tell.atOnce}`);
    const open = page(sealedCase(block({ tellHeld: true, leave: { ...block().leave!, untold: true, untoldUntil: null } })));
    expect(open).toContain(W.facts.tell.untold(null));
    const until = "2099-01-01T00:00:00.000Z";
    expect(page(sealedCase(block({ tellHeld: true, leave: { ...block().leave!, untold: true, untoldUntil: until } })))).toContain(W.facts.tell.untold(bothTimes(until)));
    expect(page(sealedCase(block({ tellHeld: true })))).toContain(W.facts.tell.record);
  });

  test("once released: [release.done] with the files left, the notice's state and the backups' day", () => {
    const released = block({ postIds: [], releasedAt: "2026-10-18T10:00:00.000Z", basis: "leave", backupsClearAt: "2026-11-17T10:00:00.000Z", noticeHeld: true, releasedPosts: 1, releasedImages: 2 });
    const shown = page(sealedCase(released, { files: 0, moved: 0, movedAt: null, toReturn: 0, filesLeft: 4, lost: 0 }));
    expect(shown).toContain(W.done(bothTimes("2026-10-18T10:00:00.000Z"), 1, 2, 4, true, bothTimes("2026-11-17T10:00:00.000Z")));
    expect(shown).toContain("held until the person may be told");
    expect(shown).not.toContain(W.button);
  });

  test("the params the key signs are the block's posts, the ground leave and the recorded leave with its reference; the action names the seal", () => {
    expect(releaseParams(block())).toEqual({ postIds: [POST], basis: "leave", leaveId: LEAVE, theirReference: "4 O 1/26" });
    expect(releaseParams(block({ leave: null }))).toBeNull();
    expect(releaseParams(block({ postIds: [] }))).toBeNull();
    expect(releaseAction(SEAL_ACTION, releaseParams(block())!)).toEqual({ action: "seal_released", target: { type: "seal", id: SEAL_ACTION }, params: releaseParams(block()) });
  });

  test("no word of the block calls a release a destruction done, and every code a release route answers has the console's words", () => {
    for (const words of [W.what, W.tells, W.leave("from a court"), W.done("x", 1, 1, 1, false, "y")]) expect(words).not.toMatch(/no longer holds|destroyed it/);
    for (const code of ["release_not_open", "release_not_reported", "release_not_quarantined", "release_preserved", "release_no_leave", "release_period_unset", "release_period_running", "release_mismatch"] as const) {
      expect(CONSOLE_MODERATION_CODES as readonly string[]).toContain(code);
      expect(MODERATION_MESSAGES[code].length).toBeGreaterThan(20);
    }
    expect(MODERATION_MESSAGES.release_period_unset).toBe(W.periodUnset);
  });
});

describe("Appeals, Home and After a restore (3d design, sections 8.2 and 8.7)", () => {
  const row: AppealRow = {
    id: "b1b2c3d4-0000-4000-8000-000000000001",
    caseId: frozenCase().id,
    decisionId: SEAL_DECISION,
    filedAt: "2026-10-10T00:00:00.000Z",
    decidedAt: "2026-10-09T00:00:00.000Z",
    deadline: "2027-04-09T00:00:00.000Z",
    ruleId: "R2",
    legal: false,
    actions: ["seal_media"],
    reviewer: "available",
    needsAdmin: true,
    mayReview: true,
    standingFirst: false,
    released: { at: "2026-10-18T10:00:00.000Z", basis: "leave" },
  };

  test("[appeals.released] on a waiting appeal of a released seal", () => {
    const shown = text(html(<AppealsView rows={{ state: "ready", value: [row, { ...row, id: "b1b2c3d4-0000-4000-8000-000000000002", released: null }] }} more={false} loadingMore={false} onLoadMore={noop} onOpenCase={noop} />));
    expect(shown).toContain(W.appealReleased(dateTime(row.released!.at), "leave"));
    expect(shown.split(W.appealReleased(dateTime(row.released!.at), "leave")).length - 1).toBe(1);
  });

  test("[home.released] one line a release of the last 30 days, and [home.undestroyed] while released files are in the quarantine", () => {
    const at = "2026-10-18T10:00:00.000Z";
    const shown = text(
      html(
        <CustodyLines
          overview={overview({ quarantine: { dueIn: 0, dueOut: 0, undestroyed: 4, oldest: null }, destructive: [{ kind: "seal_released", at, caseId: frozenCase().id, refusalId: null }] })}
          onOpenCase={noop}
        />,
      ),
    );
    expect(shown).toContain(W.homeUndestroyed(4));
    expect(shown).toContain(W.homeReleased(bothTimes(at)));
  });

  test("After a restore: a lost release, a lost leave and a lost withdrawal, each with its line and its sentence, and none with a control", () => {
    const gap = (action: string, id: string): RestoreGap => ({
      id,
      class: "release",
      actedAt: "2026-10-18T10:00:00.000Z",
      action,
      caseId: action === "seal_released" ? frozenCase().id : null,
      orderId: null,
      itemId: null,
      kinds: [],
      closedAt: null,
      disposition: null,
      closedByDecisionId: null,
    });
    const view: RestoreView = {
      importedAt: "2026-10-18T11:00:00.000Z",
      mayOpen: false,
      retentionMay: true,
      gaps: [gap("seal_released", "c1b2c3d4-0000-4000-8000-000000000001"), gap("release_leave_recorded", "c1b2c3d4-0000-4000-8000-000000000002"), gap("release_leave_withdrawn", "c1b2c3d4-0000-4000-8000-000000000003")],
      holds: [],
    };
    const out = html(<RestoreScreen view={view} role="admin" busy={null} notice={null} error={null} onOpenCase={noop} onOpenOrder={noop} onNotNeeded={noop} />);
    const shown = text(out);
    const C = RECOVERY_WORDS.classes.release;
    expect(shown).toContain(C.heading);
    for (const action of ["seal_released", "release_leave_recorded", "release_leave_withdrawn"]) {
      expect(shown).toContain(C.line(action, bothTimes("2026-10-18T10:00:00.000Z")));
      expect(shown).toContain(C.control(action));
    }
    expect(out).not.toContain(RECOVERY_WORDS.notNeeded);
    expect(out).not.toContain(RECOVERY_WORDS.openCase);
    expect(shown).toContain(RECOVERY_WORDS.site);
  });

  test("[restore.sealAgain] beside a lost seal for good whose post is released", () => {
    const view: RestoreView = {
      importedAt: "2026-10-18T11:00:00.000Z",
      mayOpen: false,
      retentionMay: false,
      gaps: [
        {
          id: "d1b2c3d4-0000-4000-8000-000000000001",
          class: "seal_final",
          actedAt: "2026-10-18T09:00:00.000Z",
          action: "case_decided",
          caseId: frozenCase().id,
          orderId: null,
          itemId: null,
          kinds: ["seal_media"],
          closedAt: null,
          disposition: null,
          closedByDecisionId: null,
          released: true,
        },
      ],
      holds: [],
    };
    expect(text(html(<RestoreScreen view={view} role="admin" busy={null} notice={null} error={null} onOpenCase={noop} onOpenOrder={noop} onNotNeeded={noop} />))).toContain(RECOVERY_WORDS.sealAgain);
  });
});
