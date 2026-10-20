import { describe, expect, test } from "vitest";
import { ModerationErrorCode } from "@korbat/contracts";
import { ModerationError, isModerationErrorCode, moderationErrorMessage } from "../src/moderation/context";

describe("the moderation module's refusals", () => {
  test("each of the fifty-four codes this module raises answers with the status the design gives it (3c design, section 10; 3e design, section 10; 3f design, section 10.6; 3d design, section 10.7)", () => {
    const statuses = {
      notice_link_invalid: 422,
      notice_link_offsite: 422,
      human_check_failed: 403,
      staff_cannot_report: 403,
      notice_not_found: 404,
      already_reported: 409,
      appeal_not_open: 422,
      appeal_exists: 409,
      reexamination_not_open: 422,
      reexamination_exists: 409,
      case_changed: 409,
      case_closed: 409,
      staff_recused: 403,
      staff_target: 403,
      admin_required: 403,
      reviewer_conflict: 403,
      decision_cap: 429,
      profile_changed: 409,
      snapshot_mismatch: 409,
      snapshot_erased: 409,
      text_not_found: 409,
      invalid_decision: 422,
      text_invalid: 422,
      text_quotes_user: 422,
      image_refused: 404,
      reveal_refused: 422,
      // 3e (design, section 10.5).
      reporting_restricted: 403,
      reply_not_open: 422,
      strike_mismatch: 409,
      standing_conflict: 409,
      ground_not_established: 422,
      // 3f: a message at the contact point that already has its disposition; Task 2's order records (section 10.6).
      message_handled: 409,
      order_needs_message: 422,
      order_exists: 409,
      order_closed: 409,
      order_event_refused: 422,
      already_released: 409,
      // Task 3: giving effect, and korbat's appeal of an order's decision.
      order_changed: 409,
      order_not_verified: 422,
      order_cap: 429,
      not_appealable: 422,
      // Task 6: recovery.
      gap_mismatch: 409,
      copy_mismatch: 409,
      // 3d Task 2 (section 10.7): the release, in the order seal_release checks, and its check at commit.
      release_not_open: 409,
      release_not_reported: 422,
      release_not_quarantined: 422,
      release_preserved: 422,
      release_no_leave: 422,
      release_period_unset: 422,
      release_period_running: 422,
      release_mismatch: 409,
      // 3d Task 6 (section 10.7): "Ask for a person" that is not open, and the two refusals the automated step records on
      // its signal, which no route answers.
      objection_not_open: 422,
      already_protected: 409,
      automation_capped: 429,
    } as const;
    // The table above is the whole of the contracts' list, so a code added there fails here until its status is pinned.
    expect(Object.keys(statuses).sort()).toEqual([...ModerationErrorCode.options].sort());
    for (const [code, status] of Object.entries(statuses) as [keyof typeof statuses, number][]) {
      const err = new ModerationError(code);
      expect([err.name, err.code, err.status], code).toEqual(["ModerationError", code, status]);
      expect(err.message, code).toBe(moderationErrorMessage(code));
      expect(err.message.length, code).toBeGreaterThan(10);
      expect(isModerationErrorCode(code), code).toBe(true);
    }
    // What the audit function raises is an answer of the decision, never one of these codes.
    expect(isModerationErrorCode("staff_confirmation_ended")).toBe(false);
    expect(isModerationErrorCode("staff_confirmation_late")).toBe(false);
    // The module's own answers beside them.
    expect([new ModerationError("not_found").status, new ModerationError("invalid_request").status]).toEqual([404, 400]);
    // A session that has not finished onboarding is refused as requireSession refuses it, in the same words.
    // 3f: order_exists carries the order that stands, the one refusal with a member.
    expect(new ModerationError("order_exists", undefined, undefined, undefined, { orderId: "x" }).details).toEqual({ orderId: "x" });
    expect(new ModerationError("onboarding_required")).toMatchObject({ status: 403, message: "Choose a handle to finish setting up your account." });
    expect([new ModerationError("rate_limited").status, new ModerationError("service_unavailable").status]).toEqual([429, 503]);
  });

  test("the console's refusals say nothing about who reported: a recusal reads the same whoever the conflict concerns, and an image that is not shown gives no reason", () => {
    expect(moderationErrorMessage("staff_recused")).not.toMatch(/report/i);
    expect(moderationErrorMessage("image_refused")).toBe("That image is not shown.");
    expect(moderationErrorMessage("reveal_refused")).not.toMatch(/@|https?:/);
  });

  test("the words of an appeal and of a re-examination are written for the person asking, and give one answer for every reason it is not open", () => {
    expect(moderationErrorMessage("appeal_not_open")).toBe("This decision cannot be appealed now.");
    expect(moderationErrorMessage("appeal_exists")).toBe("You have already appealed this decision.");
    expect(moderationErrorMessage("reexamination_not_open")).toBe("A re-examination cannot be asked for this item now.");
    expect(moderationErrorMessage("reexamination_exists")).toBe("A re-examination of this item has already been asked for.");
    // The reviewer's own refusal names their part in the case, never anyone else's.
    expect(moderationErrorMessage("reviewer_conflict")).toBe("You cannot review this appeal: you took part in its case.");
    expect(moderationErrorMessage("reviewer_conflict")).not.toMatch(/report/i);
  });

  test("the words of the notice routes are written for the person reporting, and the human check names no address", () => {
    expect(moderationErrorMessage("human_check_failed")).toBe("We could not verify that you are human. Try again.");
    expect(moderationErrorMessage("already_reported")).toBe("You already reported this; it is being looked at.");
    for (const code of ["notice_link_invalid", "notice_link_offsite", "human_check_failed", "staff_cannot_report", "notice_not_found"] as const) {
      expect(moderationErrorMessage(code), code).not.toMatch(/@|https?:/);
    }
  });
});
