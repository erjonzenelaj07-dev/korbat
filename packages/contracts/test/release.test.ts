import { describe, expect, test } from "vitest";
import {
  ALERT_KINDS,
  AppealRow,
  AuthorNoticesPage,
  CaseDecision,
  DESTRUCTIVE_DAYS,
  DESTRUCTIVE_KINDS,
  DESTRUCTIVE_MAX,
  GAP_CLASSES,
  ModerationErrorCode,
  RELEASE_BASES,
  RELEASE_LEAVE_FROM,
  RELEASE_NOTICE_APPEALS,
  RELEASE_NOTICE_STATES,
  RELEASE_POSTS_MAX,
  RELEASE_RULES,
  RETENTION,
  ReleaseNoticeView,
  STAFF_STEP_UP_ACTIONS,
  SealRelease,
  SealReleaseRequest,
  SealReleasedParams,
  StaffOverview,
  StaffStepUpOptionsRequest,
  renderAlert,
} from "../src/index";

/**
 * 3d Task 2, the release (design, sections 6.2, 7.2, 8.5, 10.1 to 10.4 and W.7): the mirror of release_rules(), the
 * closed lists, the step-up of seal_released and its params, the release block's facts, the appeal's mark, Home's list
 * of acts that cannot be taken back, the author's two reads, the codes and the two alerts. No answer holds a file's name
 * or digest, an authority's answer as a ground, or a reference outside the staff's release block.
 */
describe("the release's contracts (3d Task 2)", () => {
  const now = new Date("2026-10-18T12:00:00.000Z");
  const A = "1a2b3c4d-0000-4000-8000-000000000001";
  const B = "1a2b3c4d-0000-4000-8000-000000000002";
  const LEAVE = "1a2b3c4d-0000-4000-8000-0000000000aa";

  test("the mirror of release_rules(): no period, 30 days' notice, the backups' age, and 1000 posts a release", () => {
    expect(RELEASE_RULES).toEqual({ silenceDays: null, periodNoticeDays: 30, backupDays: 30 });
    expect(RELEASE_RULES.backupDays).toBe(RETENTION.backupDays);
    expect(RELEASE_POSTS_MAX).toBe(1000);
    expect([...RELEASE_BASES]).toEqual(["leave", "period"]);
    expect([...RELEASE_LEAVE_FROM]).toEqual(["authority", "court"]);
    // 3c's seven delivery states, then held: the CHECK of releases.author_notice.
    expect([...RELEASE_NOTICE_STATES]).toEqual(["pending", "sent", "folded", "suppressed", "no_address", "none", "failed", "held"]);
    expect(GAP_CLASSES).toContain("release");
  });

  test("seal_released: an admin's step-up on the seal's ledger row, its params strict, sorted, and the leave named exactly with the ground leave", () => {
    expect(STAFF_STEP_UP_ACTIONS.seal_released.targetType).toBe("seal");
    const params = { postIds: [A, B], basis: "leave", leaveId: LEAVE, theirReference: "ST 12/34" } as const;
    expect(SealReleasedParams.parse(params)).toEqual(params);
    expect(StaffStepUpOptionsRequest.safeParse({ action: "seal_released", target: { type: "seal", id: A }, params }).success).toBe(true);
    expect(StaffStepUpOptionsRequest.safeParse({ action: "seal_released", target: { type: "case", id: A }, params }).success).toBe(false);
    // Strict: an authority's answer is no member; nothing unknown is dropped.
    expect(SealReleasedParams.safeParse({ ...params, answer: "illegal" }).success).toBe(false);
    // Sorted and without a repeat, at least one, in lower case.
    expect(SealReleasedParams.safeParse({ ...params, postIds: [B, A] }).success).toBe(false);
    expect(SealReleasedParams.safeParse({ ...params, postIds: [A, A] }).success).toBe(false);
    expect(SealReleasedParams.safeParse({ ...params, postIds: [] }).success).toBe(false);
    expect(SealReleasedParams.safeParse({ ...params, postIds: [A.toUpperCase()] }).success).toBe(false);
    const many = Array.from({ length: RELEASE_POSTS_MAX + 1 }, (_, i) => `1a2b3c4d-0000-4000-8000-${i.toString(16).padStart(12, "0")}`);
    expect(SealReleasedParams.safeParse({ ...params, postIds: many.slice(0, RELEASE_POSTS_MAX) }).success).toBe(true);
    expect(SealReleasedParams.safeParse({ ...params, postIds: many }).success).toBe(false);
    // The leave and its reference exactly with the ground leave; the withdrawn ground `answer` is no ground.
    expect(SealReleasedParams.safeParse({ ...params, leaveId: null }).success).toBe(false);
    expect(SealReleasedParams.safeParse({ ...params, theirReference: null }).success).toBe(false);
    expect(SealReleasedParams.safeParse({ ...params, basis: "period" }).success).toBe(false);
    expect(SealReleasedParams.safeParse({ ...params, basis: "period", leaveId: null, theirReference: null }).success).toBe(true);
    expect(SealReleasedParams.safeParse({ ...params, basis: "answer" }).success).toBe(false);
    // The reference is bound as 3f binds one: some text, no control or invisible direction character, at most 200 characters.
    expect(SealReleasedParams.safeParse({ ...params, theirReference: " " }).success).toBe(false);
    expect(SealReleasedParams.safeParse({ ...params, theirReference: `ST${String.fromCharCode(0x202e)}1` }).success).toBe(false);
    expect(SealReleasedParams.safeParse({ ...params, theirReference: "x".repeat(201) }).success).toBe(false);
    // The request is the params with the assertion as stepUp.
    expect(Object.keys(SealReleaseRequest.shape).sort()).toEqual(["basis", "leaveId", "postIds", "stepUp", "theirReference"]);
  });

  test("the release block: the facts of release_facts, the posts the key names, and once released its record; never a file", () => {
    const block = {
      reported: true,
      theirReference: "ST 12/34",
      answer: "illegal",
      answeredAt: "2026-10-12T00:00:00.000Z",
      handedOverAt: null,
      quarantined: true,
      preserved: false,
      leave: { id: LEAVE, from: "court", reference: "4 O 1/26", receivedOn: "2026-10-15", untold: true, untoldUntil: null },
      tellHeld: true,
      postIds: [A],
      remaining: 0,
      silenceDays: null,
      releasedAt: null,
      basis: null,
      backupsClearAt: null,
      noticeHeld: null,
      releasedPosts: 0,
      releasedImages: 0,
    } as const;
    expect(SealRelease.parse(block)).toEqual(block);
    expect(Object.keys(SealRelease.shape).some((key) => /sha|digest|file|name/i.test(key))).toBe(false);
    expect(SealRelease.safeParse({ ...block, leave: { ...block.leave, from: "police" } }).success).toBe(false);
    expect(CaseDecision.shape.release.safeParse(undefined).success).toBe(true);
    expect(CaseDecision.shape.release.safeParse(block).success).toBe(true);
  });

  test("an appeal of a released seal is marked with the time and the ground; Home lists the acts of the last 30 days", () => {
    expect(AppealRow.shape.released.parse({ at: "2026-10-18T10:00:00.000Z", basis: "leave" })).toEqual({ at: "2026-10-18T10:00:00.000Z", basis: "leave" });
    expect(AppealRow.shape.released.parse(null)).toBeNull();
    expect([...DESTRUCTIVE_KINDS]).toEqual(["seal_released", "upload_released", "hold_ended_unreported"]);
    expect([DESTRUCTIVE_DAYS, DESTRUCTIVE_MAX]).toEqual([30, 50]);
    const destructive = StaffOverview.shape.destructive;
    expect(destructive.parse([{ kind: "seal_released", at: "2026-10-18T10:00:00.000Z", caseId: A, refusalId: null }])).toHaveLength(1);
    expect(destructive.safeParse(Array.from({ length: DESTRUCTIVE_MAX + 1 }, () => ({ kind: "seal_released", at: "2026-10-18T10:00:00.000Z", caseId: A, refusalId: null }))).success).toBe(false);
  });

  test("the author's two reads: a release by its ground, times, posts and counts, never who gave the leave or what any authority found", () => {
    const view = { id: A, basis: "leave", releasedAt: "2026-10-18T10:00:00.000Z", backupsClearAt: "2026-11-17T10:00:00.000Z", upload: false, posts: [{ id: B, createdAt: "2026-09-01T08:00:00.000Z" }], postCount: 1, images: 2, sealDecisionId: A, appeal: "none" } as const;
    expect(ReleaseNoticeView.parse(view)).toEqual(view);
    // 3d review L11 (people9): where the author's appeal of the sealing decision stands, which the notice's paragraph on
    // that decision follows: none filed, pending, or answered; never the answer's word. A held upload's release has none.
    expect([...RELEASE_NOTICE_APPEALS]).toEqual(["none", "pending", "answered"]);
    for (const appeal of RELEASE_NOTICE_APPEALS) expect(ReleaseNoticeView.parse({ ...view, appeal }).appeal).toBe(appeal);
    expect(ReleaseNoticeView.safeParse({ ...view, appeal: "kept" }).success).toBe(false);
    const { appeal: _appeal, ...withoutAppeal } = view;
    expect(ReleaseNoticeView.safeParse(withoutAppeal).success).toBe(false);
    expect(Object.keys(ReleaseNoticeView.shape).some((key) => /reference|answer|authority|court|from|leave/i.test(key))).toBe(false);
    expect(AuthorNoticesPage.parse({ notices: [{ kind: "release", id: A, at: view.releasedAt }], nextCursor: null }).notices).toHaveLength(1);
  });

  test("the codes of a release a staff route answers", () => {
    for (const code of ["release_not_open", "release_not_reported", "release_not_quarantined", "release_preserved", "release_no_leave", "release_period_unset", "release_period_running", "release_mismatch"]) {
      expect(ModerationErrorCode.safeParse(code).success, code).toBe(true);
    }
  });

  test("release_undestroyed and seal_released: a push and a sentence to every staff account, as W.7 words them", () => {
    expect(ALERT_KINDS.release_undestroyed).toMatchObject({ priority: 3, scope: "all", legs: ["push", "mail"], mail: "sentence", facts: ["count", "oldestAt"] });
    expect(ALERT_KINDS.seal_released).toMatchObject({ priority: 3, scope: "all", legs: ["push", "mail"], mail: "sentence", facts: ["at", "posts", "uploads"] });
    expect(renderAlert("release_undestroyed", { count: 4, oldestAt: "2026-10-17T08:05:00.000Z" }, now)).toEqual({
      title: "Released files still exist",
      sentence: "4 released files are still recorded in the quarantine, the oldest release of 2026-10-17 08:05 UTC.",
      todo: "Whoever has the server runs the README's steps under Quarantine: the list's destroy lines name them. This repeats daily until each is recorded as destroyed.",
    });
    expect(renderAlert("seal_released", { at: "2026-10-18T11:40:00.000Z", posts: 2, uploads: 0 }, now)).toEqual({
      title: "An admin released sealed images",
      sentence: "An admin released sealed images at 11:40 UTC: 2 posts, 0 held uploads. The files are to be destroyed.",
      todo: "This cannot be taken back. Every staff account gets this mail, the admin who did it too. If you did not expect it, look at the case or at Held uploads now and tell the operator: until the files are destroyed and the backups have aged out, a release that should not have happened can still be met by keeping them.",
    });
  });
});
