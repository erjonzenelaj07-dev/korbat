import { describe, expect, test } from "vitest";
import { ModerationErrorCode } from "@korbat/contracts";
import { ModerationError, isModerationErrorCode, moderationErrorMessage } from "../src/moderation/context";

describe("the moderation module's refusals", () => {
  test("each of the twelve codes this module raises answers with the status the design gives it (3c design, section 10)", () => {
    const statuses = {
      already_reported: 409,
      case_changed: 409,
      case_closed: 409,
      staff_recused: 403,
      staff_target: 403,
      admin_required: 403,
      decision_cap: 429,
      profile_changed: 409,
      snapshot_mismatch: 409,
      snapshot_erased: 409,
      text_not_found: 409,
      invalid_decision: 422,
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
  });
});
