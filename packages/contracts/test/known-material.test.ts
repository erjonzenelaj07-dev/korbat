import { describe, expect, test } from "vitest";
import {
  ALERT_KINDS,
  ALERT_KIND_LIST,
  AUTOMATION_RULES,
  CHECK_STATES,
  CaseDecidedParams,
  CaseSignal,
  HeldUpload,
  MATCH_ANSWER_REASONS,
  MATCH_ANSWER_REASON_LABELS,
  MATCH_HASH_TYPES,
  MATCH_KINDS,
  MATCH_RETRY_BATCH,
  MediaErrorCode,
  MediaStatusResponse,
  ModerationErrorCode,
  QueueRow,
  RestoreGap,
  SEAL_DRAFTS,
  SENTENCE_MAIL_KINDS,
  STAFF_STEP_UP_ACTIONS,
  StaffStepUpOptionsRequest,
  UPLOAD_END_REASONS,
  UPLOAD_END_REASON_LABELS,
  UPLOAD_ENDS,
  UploadHoldEndedParams,
  UploadRefusalView,
  UploadReleasedParams,
  alertPlaceholders,
  renderAlert,
  statementMatchKind,
} from "../src/index";

/**
 * Known material's contracts (3d design, sections 6.7, 7.8, 7.11, 7.12, 10 and W.7; Task 7): the closed lists each CHECK
 * is written from, the derived kind of match a statement prints, the strict params of the two step-ups of Held uploads
 * and the reason an answer without a seal on an acting match signs, the shapes staff and the uploader are given (never a
 * hash, a file or a handle), and the two alerts.
 */
describe("known material's constants", () => {
  test("the closed lists of section 10.1, each the CHECK of its column, and the retry's batch", () => {
    expect(CHECK_STATES).toEqual(["pending", "clear", "matched", "unchecked", "capped"]);
    expect(MATCH_HASH_TYPES).toEqual(["sha256", "sha1", "md5", "pdq"]);
    expect(MATCH_KINDS).toEqual(["exact", "near"]);
    expect(UPLOAD_ENDS).toEqual(["report", "no_report"]);
    expect(UPLOAD_END_REASONS).toEqual(["source_withdrew", "counsel_no_duty", "other"]);
    expect(MATCH_ANSWER_REASONS).toEqual(["source_withdrew", "counsel", "other"]);
    expect(MATCH_RETRY_BATCH).toBe(20);
    // Every reason has its console's label, and no label tells an admin which end to take.
    expect(Object.keys(UPLOAD_END_REASON_LABELS)).toEqual([...UPLOAD_END_REASONS]);
    expect(Object.keys(MATCH_ANSWER_REASON_LABELS)).toEqual([...MATCH_ANSWER_REASONS]);
    for (const label of [...Object.values(UPLOAD_END_REASON_LABELS), ...Object.values(MATCH_ANSWER_REASON_LABELS)]) expect(label).not.toMatch(/Report when|Choose/);
    // The numbers of known material in automation_rules(), which a database test holds column for member.
    expect([AUTOMATION_RULES.refusalsPerHour, AUTOMATION_RULES.noReportHours, AUTOMATION_RULES.matchTimeoutMs, AUTOMATION_RULES.matchRetryHours, AUTOMATION_RULES.matcherDownMinutes, AUTOMATION_RULES.pdqMinQuality, AUTOMATION_RULES.matchKeepDays]).toEqual([
      20, 24, 3000, 24, 15, 50, 180,
    ]);
  });

  test("a statement's kind of match is derived, never copied: exact only for an exact match of a cryptographic hash, near for every perceptual match (W.3)", () => {
    expect(statementMatchKind("sha256", "exact")).toBe("exact");
    expect(statementMatchKind("sha1", "exact")).toBe("exact");
    expect(statementMatchKind("md5", "exact")).toBe("exact");
    expect(statementMatchKind("pdq", "exact")).toBe("near");
    expect(statementMatchKind("sha256", "near")).toBe("near");
    expect(statementMatchKind("pdq", "near")).toBe("near");
  });

  test("the facts draft of a seal on a match says what the comparison found, holds the comparison's place and nothing of a hash, a list or a class", () => {
    expect(SEAL_DRAFTS.facts.match_post).toBe("{comparison}. korbat's staff do not open such an image, and korbat has not assessed it.");
    expect(SEAL_DRAFTS.facts.match_post).not.toMatch(/reported|is child sexual abuse material|confirmed/);
  });
});

describe("the step-ups of Held uploads and the reason of an answer without a seal (10.4)", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";

  test("upload_hold_ended: an end with no default, a reason exactly with no_report, strict", () => {
    expect(UploadHoldEndedParams.safeParse({ endAs: "report", reason: null }).success).toBe(true);
    expect(UploadHoldEndedParams.safeParse({ endAs: "no_report", reason: "counsel_no_duty" }).success).toBe(true);
    expect(UploadHoldEndedParams.safeParse({ endAs: "no_report", reason: null }).success).toBe(false);
    expect(UploadHoldEndedParams.safeParse({ endAs: "report", reason: "other" }).success).toBe(false);
    // Neither end is a default: a request without it is refused, and a member the schema does not know too.
    expect(UploadHoldEndedParams.safeParse({ reason: null }).success).toBe(false);
    expect(UploadHoldEndedParams.safeParse({ endAs: "report", reason: null, note: "x" }).success).toBe(false);
    expect(STAFF_STEP_UP_ACTIONS.upload_hold_ended.targetType).toBe("upload_refusal");
    expect(StaffStepUpOptionsRequest.safeParse({ action: "upload_hold_ended", target: { type: "upload_refusal", id: uuid }, params: { endAs: "report", reason: null } }).success).toBe(true);
    expect(StaffStepUpOptionsRequest.safeParse({ action: "upload_hold_ended", target: { type: "upload_refusal", id: "AAAAAAAA-1111-4111-8111-111111111111" }, params: { endAs: "report", reason: null } }).success).toBe(false);
  });

  test("upload_released: the ground, and the leave with its reference exactly with the ground leave; no answer is a param", () => {
    expect(UploadReleasedParams.safeParse({ basis: "leave", leaveId: uuid, theirReference: "AZ 12/2026" }).success).toBe(true);
    expect(UploadReleasedParams.safeParse({ basis: "leave", leaveId: null, theirReference: null }).success).toBe(false);
    expect(UploadReleasedParams.safeParse({ basis: "period", leaveId: null, theirReference: null }).success).toBe(true);
    expect(UploadReleasedParams.safeParse({ basis: "period", leaveId: null, theirReference: null, answer: "illegal" }).success).toBe(false);
    expect(STAFF_STEP_UP_ACTIONS.upload_released.targetType).toBe("upload_refusal");
  });

  test("case_decided's matchAnswerReason: one of the three, absent reads null, and only on a final decision that holds no seal", () => {
    const base = {
      kind: "final",
      stateVersion: 3,
      throughSeq: 2,
      reviewsDecisionId: null,
      snapshotId: uuid,
      snapshotDigest: "a".repeat(64),
      outcome: "no_violation",
      ground: null,
      ruleId: null,
      rulesVersion: 3,
      redressVersion: 4,
      category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS",
      categoryKeyword: null,
      actions: [],
      factsDigest: null,
      reasonDigest: null,
      legalReferenceDigest: null,
      unfounded: [],
      replaced: false,
    };
    expect(CaseDecidedParams.safeParse(base).success).toBe(true);
    for (const reason of MATCH_ANSWER_REASONS) expect(CaseDecidedParams.safeParse({ ...base, matchAnswerReason: reason }).success, reason).toBe(true);
    expect(CaseDecidedParams.safeParse({ ...base, matchAnswerReason: null }).success).toBe(true);
    expect(CaseDecidedParams.safeParse({ ...base, matchAnswerReason: "because" }).success).toBe(false);
    expect(CaseDecidedParams.safeParse({ ...base, kind: "interim", throughSeq: 0, outcome: "restricted", ground: "incompatible", ruleId: "R2", factsDigest: "b".repeat(64), reasonDigest: "c".repeat(64), actions: [{ kind: "seal_media", mediaId: null }], matchAnswerReason: "other" }).success).toBe(false);
  });
});

describe("what staff and the uploader are given", () => {
  const record = { source: "test", listVersion: "test-1", hashType: "sha256", matchKind: "exact", classification: "test_listed", listed: true, acting: true, queriedAt: "2026-10-19T10:00:00.000Z" };

  test("a case's signal carries a match's record, never a hash; a queue row its flag", () => {
    expect(CaseSignal.parse({ itemId: "11111111-1111-4111-8111-111111111111", kind: "known_match", thresholdVersion: null, match: record }).match).toEqual(record);
    expect(Object.keys(CaseSignal.shape.match.unwrap().shape)).not.toContain("hash");
    expect(Object.keys(QueueRow.shape)).toContain("matchFlag");
  });

  test("a held upload carries its record, a count of the uploader's other holds and no handle, hash, file or image; the uploader's view no classification", () => {
    const names = Object.keys(HeldUpload.shape);
    for (const forbidden of ["handle", "hash", "sha256", "pdq", "file", "image", "email", "ownerId", "accountId", "userId"]) expect(names, forbidden).not.toContain(forbidden);
    const view = Object.keys(UploadRefusalView.shape);
    for (const forbidden of ["classification", "listVersion", "hash", "hashType", "admin", "staffHandle"]) expect(view, forbidden).not.toContain(forbidden);
    expect(UploadRefusalView.shape.listedAs.value).toBe("csam");
  });

  test("the owner's status of a refused upload holds its refusal and nothing of the file; upload_refused is a media error", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect(MediaStatusResponse.parse({ id, status: "refused", refusalId: "11111111-1111-4111-8111-111111111111" })).toEqual({ id, status: "refused", refusalId: "11111111-1111-4111-8111-111111111111" });
    expect(MediaStatusResponse.safeParse({ id, status: "refused", refusalId: "11111111-1111-4111-8111-111111111111", blurhash: "L2Eo_P_3jb_3~qoL" }).success).toBe(true);
    expect(MediaErrorCode.options).toContain("upload_refused");
    for (const code of ["hold_not_open", "invalid_hold_end", "image_matched"] as const) expect(ModerationErrorCode.options).toContain(code);
  });
});

describe("the two alerts of known material (W.7)", () => {
  const now = new Date("2026-10-19T12:00:00.000Z");

  test("they follow automated_waiting at the end of the list, each a push and a sentence to every staff account, with counts and times only", () => {
    expect(ALERT_KIND_LIST.slice(-2)).toEqual(["matcher_down", "hold_ended_unreported"]);
    expect(ALERT_KINDS.matcher_down).toEqual({ priority: 3, scope: "all", legs: ["push", "mail"], mail: "sentence", facts: ["since", "count", "refusalsCapped"] });
    expect(ALERT_KINDS.hold_ended_unreported).toEqual({ priority: 3, scope: "all", legs: ["push", "mail"], mail: "sentence", facts: ["at", "deletesAt"] });
    for (const kind of ["matcher_down", "hold_ended_unreported"] as const) {
      expect(SENTENCE_MAIL_KINDS).toContain(kind);
      // No number is typed in their words: each comes from a fact or from AUTOMATION_RULES.
      for (const name of alertPlaceholders(kind)) expect(ALERT_KINDS[kind].facts.includes(name) || Object.hasOwn(AUTOMATION_RULES, name), `${kind} {${name}}`).toBe(true);
    }
  });

  test("each renders with two sets of facts that differ only in digits, holds no @ and no http, and tells no admin which end to take", () => {
    const DIGIT = /[0-9]/g;
    const pairs = [
      [renderAlert("matcher_down", { since: "2026-10-19T10:05:00.000Z", count: 2, refusalsCapped: 1 }, now), renderAlert("matcher_down", { since: "2026-10-19T11:07:00.000Z", count: 5, refusalsCapped: 3 }, now)],
      [renderAlert("hold_ended_unreported", { at: "2026-10-19T10:05:00.000Z", deletesAt: "2026-10-20T10:05:00.000Z" }, now), renderAlert("hold_ended_unreported", { at: "2026-10-19T11:07:00.000Z", deletesAt: "2026-10-20T11:07:00.000Z" }, now)],
    ] as const;
    for (const [a, b] of pairs) {
      expect(JSON.stringify(a).replace(DIGIT, "0")).toBe(JSON.stringify(b).replace(DIGIT, "0"));
      expect(JSON.stringify(a)).not.toMatch(/@|http/);
      expect(JSON.stringify(a)).not.toMatch(/Report when|Choose "No report" only/);
    }
    expect(pairs[0][0].sentence).toBe("Uploads are not being compared as usual. 2 are unchecked, the oldest since 10:05 UTC. 1 matched within an hour over the limit of 20 refusals and were not refused.");
    expect(pairs[1][0].title).toBe("A hold ended without a report");
    // The row written at once over the limit may count no unchecked upload: its sentence is left out.
    expect(renderAlert("matcher_down", { since: "2026-10-19T10:05:00.000Z", count: 0, refusalsCapped: 1 }, now).sentence).toBe(
      "Uploads are not being compared as usual. 1 matched within an hour over the limit of 20 refusals and were not refused.",
    );
  });

  test("seal_released's line names Held uploads beside the case (Task 7)", () => {
    expect(renderAlert("seal_released", { at: "2026-10-19T10:05:00.000Z", posts: 0, uploads: 1 }, now).todo).toContain("look at the case or at Held uploads now");
  });
});

describe("a lost end of a hold after a restore (8.7, [restore.holdEnd])", () => {
  const gap = { id: "1a2b3c4d-0000-4000-8000-000000000001", class: "release", actedAt: "2026-10-19T10:00:00.000Z", action: "upload_hold_ended", caseId: null, orderId: null, itemId: null, kinds: [], closedAt: null, disposition: null, closedByDecisionId: null };

  test("RestoreGap's hold says how the lost end ended and whether the refusal is there; any other gap has none", () => {
    expect(RestoreGap.parse({ ...gap, hold: { endAs: "report", present: true } }).hold).toEqual({ endAs: "report", present: true });
    expect(RestoreGap.parse(gap).hold).toBeUndefined();
    expect(RestoreGap.safeParse({ ...gap, hold: { endAs: "released", present: true } }).success).toBe(false);
    expect(RestoreGap.safeParse({ ...gap, hold: { endAs: "no_report" } }).success).toBe(false);
  });
});
