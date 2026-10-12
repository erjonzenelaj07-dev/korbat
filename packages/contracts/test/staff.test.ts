import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  AuditEntry,
  AuditPage,
  AuditPageQuery,
  AuthenticationResponseJSON,
  CEREMONY_CHALLENGE,
  CHALLENGE_PURPOSES,
  DisplayName,
  PasskeyOptionsResponse,
  STAFF_AUDIT_PAGE_SIZE,
  STAFF_STEP_UP_ACTIONS,
  STAFF_STEP_UP_CHALLENGE,
  StaffEnrollOptionsRequest,
  StaffEnrollOptionsResponse,
  StaffEnrollVerifyRequest,
  StaffEnrollVerifyResponse,
  StaffErrorCode,
  StaffKey,
  StaffKeyKind,
  StaffKeyName,
  StaffKeysResponse,
  StaffMe,
  StaffRole,
  StaffSession,
  StaffSessionRevokeRequest,
  StaffSessionsResponse,
  StaffSignInOptionsResponse,
  StaffSignInVerifyRequest,
  StaffSignInVerifyResponse,
  StaffStepUpActionName,
  StaffStepUpOptionsRequest,
  StaffStepUpOptionsResponse,
  StaffStoredAssertion,
  stepUpActionHash,
  stepUpActionText,
  stepUpBinding,
  stepUpBindingText,
} from "../src/index";

const BELL = String.fromCharCode(7);
/** U+202E, the right-to-left override: invisible, and refused by the display-name rules. */
const RLO = String.fromCharCode(0x202e);

/** A base64url string of exactly n characters. */
const b64 = (n: number) => "A".repeat(n);

const at = "2026-09-30T10:00:00.000Z";
const later = "2026-09-30T22:00:00.000Z";
const token = "a".repeat(43);
const uuid = "3f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
const hex = "ab".repeat(32);

/** What @simplewebauthn/browser's startRegistration returns for a security key. */
const registration = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: b64(200), attestationObject: b64(400), transports: ["usb", "nfc"] },
  clientExtensionResults: {},
  authenticatorAttachment: "cross-platform",
};

/** What startAuthentication returns for a discoverable staff key: the user handle is there. */
const assertion = {
  id: "q2Xx0w8bRk6nV8yQ0f2mUg",
  rawId: "q2Xx0w8bRk6nV8yQ0f2mUg",
  type: "public-key",
  response: { clientDataJSON: b64(200), authenticatorData: b64(50), signature: b64(96), userHandle: b64(43) },
  clientExtensionResults: {},
  authenticatorAttachment: "cross-platform",
};

const options = { challenge: b64(78), rpId: "console.korbat.example", allowCredentials: [], userVerification: "required", timeout: 300000 };

/** Every key of an object removed in turn must make the schema refuse it. */
function everyFieldRequired(schema: { safeParse: (value: unknown) => { success: boolean } }, value: Record<string, unknown>) {
  for (const key of Object.keys(value)) {
    const partial: Record<string, unknown> = { ...value };
    delete partial[key];
    expect(schema.safeParse(partial).success, key).toBe(false);
  }
}

describe("staff error codes", () => {
  test("are exactly the ten codes of the staff flows", () => {
    expect(StaffErrorCode.options).toEqual([
      "staff_session_required",
      "staff_key_invalid",
      "staff_key_suspended",
      "staff_key_limit",
      "staff_key_not_device_bound",
      "staff_key_not_user_verified",
      "staff_key_refused",
      "staff_enrollment_invalid",
      "staff_step_up_required",
      "staff_step_up_invalid",
    ]);
    expect(StaffErrorCode.safeParse("passkey_invalid").success).toBe(false);
  });
});

describe("staff roles, key names and kinds", () => {
  test("a staff role is moderator or admin, never user", () => {
    expect(StaffRole.options).toEqual(["moderator", "admin"]);
    expect(StaffRole.safeParse("user").success).toBe(false);
  });

  test("a key's name follows the display-name rules", () => {
    expect(StaffKeyName).toBe(DisplayName);
    expect(StaffKeyName.parse("  Blue key ")).toBe("Blue key");
    expect(StaffKeyName.safeParse("x".repeat(51)).success).toBe(false);
    expect(StaffKeyName.safeParse(`Blue${BELL}key`).success).toBe(false);
    expect(StaffKeyName.safeParse(`Blue${RLO}key`).success).toBe(false);
  });

  test("a key is a security key or this device", () => {
    expect(StaffKeyKind.options).toEqual(["security_key", "this_device"]);
    expect(StaffKeyKind.safeParse("platform").success).toBe(false);
  });
});

describe("enrolment", () => {
  test("options are asked for with the link's token, the key's name and its kind", () => {
    const request = { token, name: " Blue key ", kind: "security_key" };
    expect(StaffEnrollOptionsRequest.parse(request)).toEqual({ token, name: "Blue key", kind: "security_key" });
    expect(StaffEnrollOptionsRequest.parse({ ...request, kind: "this_device" }).kind).toBe("this_device");
    everyFieldRequired(StaffEnrollOptionsRequest, request);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, token: "a".repeat(42) }).success).toBe(false);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, token: `${"a".repeat(42)}=` }).success).toBe(false);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, name: "" }).success).toBe(false);
    expect(StaffEnrollOptionsRequest.safeParse({ ...request, kind: "passkey" }).success).toBe(false);
  });

  test("the options answer says whether the console's relying party ID is the app's", () => {
    const answer = { options: { ...options, rp: { id: "localhost", name: "korbat" } }, rpShared: true };
    expect(StaffEnrollOptionsResponse.parse(answer)).toEqual(answer);
    expect(StaffEnrollOptionsResponse.parse({ ...answer, rpShared: false }).rpShared).toBe(false);
    expect(StaffEnrollOptionsResponse.safeParse({ options: answer.options }).success).toBe(false);
    expect(StaffEnrollOptionsResponse.safeParse({ ...answer, rpShared: "no" }).success).toBe(false);
    expect(StaffEnrollOptionsResponse.safeParse({ ...answer, options: { challenge: "abc+/" } }).success).toBe(false);
  });

  test("verify takes the token, the name and a registration response, never an assertion", () => {
    const request = { token, name: "Blue key", response: registration };
    expect(StaffEnrollVerifyRequest.parse(request)).toEqual(request);
    everyFieldRequired(StaffEnrollVerifyRequest, request);
    expect(StaffEnrollVerifyRequest.safeParse({ ...request, response: assertion }).success).toBe(false);
    expect(StaffEnrollVerifyRequest.safeParse({ ...request, name: "x".repeat(51) }).success).toBe(false);
  });

  test("verify answers with the key it stored", () => {
    const key = { id: uuid, name: "Blue key", createdAt: at, lastUsedAt: null };
    expect(StaffEnrollVerifyResponse.parse({ key })).toEqual({ key });
    expect(StaffEnrollVerifyResponse.safeParse({}).success).toBe(false);
  });
});

describe("sign-in", () => {
  test("the options answer is the library's options with a base64url challenge", () => {
    expect(StaffSignInOptionsResponse).toBe(PasskeyOptionsResponse);
    expect(StaffSignInOptionsResponse.parse({ options })).toEqual({ options });
  });

  test("verify takes an assertion, never a registration", () => {
    expect(StaffSignInVerifyRequest.parse({ response: assertion })).toEqual({ response: assertion });
    expect(StaffSignInVerifyRequest.safeParse({ response: registration }).success).toBe(false);
    expect(StaffSignInVerifyRequest.safeParse({}).success).toBe(false);
  });

  test("verify answers with the new session, as /me describes it", () => {
    expect(StaffSignInVerifyResponse).toBe(StaffMe);
  });
});

describe("the staff account and its session", () => {
  const me = {
    handle: "mod_ada",
    role: "moderator",
    sessionHandle: uuid,
    idleExpiresAt: at,
    idleSecondsLeft: 900,
    absoluteExpiresAt: later,
    absoluteSecondsLeft: 43_200,
  };

  test("/me carries the handle, the role, the session's handle and both expiries with the seconds left", () => {
    expect(StaffMe.parse(me)).toEqual(me);
    expect(StaffMe.parse({ ...me, role: "admin", idleSecondsLeft: 0, absoluteSecondsLeft: 0 }).role).toBe("admin");
    everyFieldRequired(StaffMe, me);
  });

  test("/me refuses a user's role, a session handle that is not a uuid, and seconds that are negative or fractional", () => {
    expect(StaffMe.safeParse({ ...me, role: "user" }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, sessionHandle: "nope" }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, idleSecondsLeft: -1 }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, absoluteSecondsLeft: 1.5 }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, idleExpiresAt: "tonight" }).success).toBe(false);
  });

  test("the idle end never lies beyond the absolute end", () => {
    expect(StaffMe.safeParse({ ...me, idleSecondsLeft: 43_201 }).success).toBe(false);
    expect(StaffMe.safeParse({ ...me, idleSecondsLeft: 43_200 }).success).toBe(true);
  });

  test("a staff session is listed with its handle, browser, dates and whether it is this one", () => {
    const session = { handle: uuid, browser: "Firefox on Linux", createdAt: at, lastUsedAt: at, current: true };
    expect(StaffSession.parse(session)).toEqual(session);
    everyFieldRequired(StaffSession, session);
    expect(StaffSession.safeParse({ ...session, handle: "abc" }).success).toBe(false);
    expect(StaffSessionsResponse.parse({ sessions: [session] })).toEqual({ sessions: [session] });
    expect(StaffSessionsResponse.parse({ sessions: [] })).toEqual({ sessions: [] });
    expect(StaffSessionsResponse.safeParse({}).success).toBe(false);
  });

  test("a staff key is listed with its id, name and dates, never its public key", () => {
    const key = { id: uuid, name: "Blue key", createdAt: at, lastUsedAt: at };
    expect(StaffKey.parse(key)).toEqual(key);
    expect(StaffKey.parse({ ...key, lastUsedAt: null }).lastUsedAt).toBeNull();
    // A member the reader never sends is dropped, not passed on to the page.
    expect(StaffKey.parse({ ...key, publicKey: b64(100) })).toEqual(key);
    everyFieldRequired(StaffKey, key);
    expect(StaffKeysResponse.parse({ keys: [key] })).toEqual({ keys: [key] });
    expect(StaffKeysResponse.safeParse({ keys: [{ ...key, id: 7 }] }).success).toBe(false);
  });
});

describe("step-up actions", () => {
  test("there are four: revoking a staff session, whose target is a staff session and whose params are empty, and the three of moderation cases", () => {
    expect(Object.keys(STAFF_STEP_UP_ACTIONS)).toEqual(["staff_session_revoked", "case_decided", "appeals_reviewed", "identity_revealed"]);
    expect(StaffStepUpActionName.options).toEqual(Object.keys(STAFF_STEP_UP_ACTIONS));
    const spec = STAFF_STEP_UP_ACTIONS.staff_session_revoked;
    expect(spec.targetType).toBe("staff_session");
    expect(spec.targetId.safeParse(uuid).success).toBe(true);
    expect(spec.targetId.safeParse("abc").success).toBe(false);
    // Only the lower-case spelling PostgreSQL writes: the id is hashed as sent, and the audit row records the database's.
    expect(spec.targetId.safeParse(uuid.toUpperCase()).success).toBe(false);
    expect(spec.targetId.safeParse(uuid.slice(0, 9) + uuid.slice(9).toUpperCase()).success).toBe(false);
    expect(spec.params.parse({})).toEqual({});
    // Params are hashed as they are sent, so a member the schema does not know is refused, never dropped.
    expect(spec.params.safeParse({ all: true }).success).toBe(false);
  });

  test("the options request names the action, its target and its params, each checked by that action's own schema", () => {
    const request = { action: "staff_session_revoked", target: { type: "staff_session", id: uuid }, params: {} };
    expect(StaffStepUpOptionsRequest.parse(request)).toEqual(request);
    everyFieldRequired(StaffStepUpOptionsRequest, request);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, action: "role_granted" }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_key", id: uuid } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_session", id: "abc" } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_session", id: uuid.toUpperCase() } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, target: { type: "staff_session", id: uuid, extra: 1 } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, params: { all: true } }).success).toBe(false);
    expect(StaffStepUpOptionsRequest.safeParse({ ...request, stepUp: assertion }).success).toBe(false);
  });

  test("the options answer is the library's options", () => {
    expect(StaffStepUpOptionsResponse).toBe(PasskeyOptionsResponse);
    expect(StaffStepUpOptionsResponse.parse({ options: { ...options, allowCredentials: [{ id: b64(22), type: "public-key" }] } }).options.challenge).toBe(options.challenge);
  });

  test("revoking a session takes its params with the step-up assertion added", () => {
    expect(StaffSessionRevokeRequest.parse({ stepUp: assertion })).toEqual({ stepUp: assertion });
    expect(StaffSessionRevokeRequest.safeParse({}).success).toBe(false);
    expect(StaffSessionRevokeRequest.safeParse({ stepUp: registration }).success).toBe(false);
    expect(StaffSessionRevokeRequest.safeParse({ stepUp: assertion, all: true }).success).toBe(false);
  });

  test("the stored assertion is the authenticator data, client data and signature, bounded as the browser's answer is", () => {
    const stored = { authenticatorData: b64(50), clientDataJSON: b64(200), signature: b64(96) };
    expect(StaffStoredAssertion.parse(stored)).toEqual(stored);
    everyFieldRequired(StaffStoredAssertion, stored);
    expect(StaffStoredAssertion.shape.signature).toBe(AuthenticationResponseJSON.shape.response.shape.signature);
    expect(StaffStoredAssertion.safeParse({ ...stored, signature: b64(1025) }).success).toBe(false);
    expect(StaffStoredAssertion.safeParse({ ...stored, clientDataJSON: "ab/cd" }).success).toBe(false);
    expect(StaffStoredAssertion.safeParse({ ...stored, userHandle: b64(43) }).success).toBe(false);
  });
});

describe("the step-up actions of moderation cases", () => {
  const image = "7a1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
  const otherImage = "9a1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a";
  const TC = "STATEMENT_CATEGORY_OTHER_VIOLATION_TC";
  const SPEECH = "STATEMENT_CATEGORY_ILLEGAL_OR_HARMFUL_SPEECH";
  const decided = STAFF_STEP_UP_ACTIONS.case_decided.params;
  const reviewed = STAFF_STEP_UP_ACTIONS.appeals_reviewed.params;
  const revealed = STAFF_STEP_UP_ACTIONS.identity_revealed.params;

  /** An interim withhold under R1: the least a restricting decision carries. */
  const interim = {
    kind: "interim",
    stateVersion: 0,
    throughSeq: 0,
    reviewsDecisionId: null,
    snapshotId: uuid,
    snapshotDigest: hex,
    outcome: "restricted",
    ground: "incompatible",
    ruleId: "R1",
    rulesVersion: 2,
    redressVersion: 1,
    category: TC,
    categoryKeyword: null,
    actions: [{ kind: "withhold", mediaId: null }],
    factsDigest: hex,
    reasonDigest: hex,
    legalReferenceDigest: null,
    // 3e: always present (design, section 10.4).
    unfounded: [] as string[],
    replaced: false,
  };
  const final = { ...interim, kind: "final", throughSeq: 3, actions: [{ kind: "remove", mediaId: null }] };
  const noAction = { ...final, outcome: "no_violation", ground: null, ruleId: null, actions: [], factsDigest: null, reasonDigest: null };
  const legal = { ...final, ground: "illegal", ruleId: null, category: SPEECH, legalReferenceDigest: hex };
  const correction = {
    ...interim,
    kind: "correction",
    reviewsDecisionId: "5f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a",
    outcome: "reversed",
    ground: null,
    ruleId: null,
    factsDigest: null,
    actions: [{ kind: "restore", mediaId: null }],
  };
  const review = {
    stateVersion: 4,
    appealId: "4f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a",
    snapshotId: uuid,
    snapshotDigest: hex,
    outcome: "reversed",
    rulesVersion: 2,
    redressVersion: 1,
    category: TC,
    actions: [{ kind: "restore", mediaId: null }],
    reasonDigest: hex,
  };
  const reveal = { reasonCategory: "impersonation_claim", reasonDigest: hex };

  const refused = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) => schema.safeParse(value).success === false;

  test("each has its target type, and a target id in PostgreSQL's lower-case spelling only", () => {
    expect(STAFF_STEP_UP_ACTIONS.case_decided.targetType).toBe("case");
    expect(STAFF_STEP_UP_ACTIONS.appeals_reviewed.targetType).toBe("decision");
    expect(STAFF_STEP_UP_ACTIONS.identity_revealed.targetType).toBe("intake_item");
    for (const action of ["case_decided", "appeals_reviewed", "identity_revealed"] as const) {
      const spec = STAFF_STEP_UP_ACTIONS[action];
      expect(spec.targetId.safeParse(uuid).success, action).toBe(true);
      expect(spec.targetId.safeParse(uuid.toUpperCase()).success, action).toBe(false);
      expect(spec.targetId.safeParse("abc").success, action).toBe(false);
    }
  });

  test("case_decided takes an interim, a final and a correcting decision, each exactly as sent", () => {
    for (const params of [interim, final, noAction, legal, correction]) expect(decided.parse(params), params.kind).toEqual(params);
    everyFieldRequired(decided, interim);
    // A final decision that finds no breach may still name the rule it examined, and may lift the case's interim withholds.
    expect(decided.parse({ ...noAction, ground: "incompatible", ruleId: "R5", actions: [{ kind: "restore", mediaId: null }] }).ruleId).toBe("R5");
    expect(decided.parse({ ...noAction, outcome: "not_evident" }).outcome).toBe("not_evident");
    expect(decided.parse({ ...legal, categoryKeyword: "KEYWORD_TERRORIST_CONTENT" }).categoryKeyword).toBe("KEYWORD_TERRORIST_CONTENT");
  });

  test("the params are strict and unchanged: a member they do not know is refused, and nothing is trimmed, folded or defaulted", () => {
    expect(refused(decided, { ...interim, note: "x" })).toBe(true);
    expect(refused(decided, { ...interim, actions: [{ kind: "withhold", mediaId: null, extra: 1 }] })).toBe(true);
    expect(refused(reviewed, { ...review, ground: null })).toBe(true);
    expect(refused(revealed, { ...reveal, text: "why" })).toBe(true);
    // No transform: an upper-case id or digest is refused, never lower-cased.
    expect(refused(decided, { ...interim, snapshotId: uuid.toUpperCase() })).toBe(true);
    expect(refused(decided, { ...interim, snapshotDigest: hex.toUpperCase() })).toBe(true);
    expect(refused(decided, { ...interim, factsDigest: ` ${hex}` })).toBe(true);
    expect(refused(decided, { ...interim, actions: [{ kind: "withhold_media", mediaId: image.toUpperCase() }] })).toBe(true);
    // Numbers are whole and in range.
    for (const stateVersion of [-1, 1.5, "0", 2_147_483_648]) expect(refused(decided, { ...interim, stateVersion }), String(stateVersion)).toBe(true);
    for (const rulesVersion of [0, 1.5, 32_768]) expect(refused(decided, { ...interim, rulesVersion }), String(rulesVersion)).toBe(true);
    expect(refused(decided, { ...interim, category: "STATEMENT_CATEGORY_PORNOGRAPHY_OR_SEXUALIZED_CONTENT" })).toBe(true);
    expect(refused(decided, { ...interim, ruleId: "R7" })).toBe(true);
    expect(refused(decided, { ...interim, kind: "review" })).toBe(true);
  });

  test("the outcome goes with the kind: an interim decision restricts, a final one restricts or finds no breach, a correction reverses", () => {
    expect(refused(decided, { ...interim, outcome: "no_violation" })).toBe(true);
    expect(refused(decided, { ...final, outcome: "kept" })).toBe(true);
    expect(refused(decided, { ...final, outcome: "reversed" })).toBe(true);
    expect(refused(decided, { ...correction, outcome: "restricted" })).toBe(true);
    expect(refused(decided, { ...correction, outcome: "kept" })).toBe(true);
    expect(decided.parse({ ...correction, outcome: "partly_reversed" }).outcome).toBe("partly_reversed");
    expect(refused(reviewed, { ...review, outcome: "restricted" })).toBe(true);
    expect(reviewed.parse({ ...review, outcome: "kept", actions: [] }).outcome).toBe("kept");
  });

  test("an interim decision answers no item: its throughSeq is 0", () => {
    expect(refused(decided, { ...interim, throughSeq: 1 })).toBe(true);
    expect(decided.parse({ ...final, throughSeq: 1 }).throughSeq).toBe(1);
  });

  test("a restriction carries its ground, its facts and its reason; a rule ground its rule; a legal ground its reference, and no rule", () => {
    expect(refused(decided, { ...interim, ground: null, ruleId: null })).toBe(true);
    expect(refused(decided, { ...interim, factsDigest: null })).toBe(true);
    expect(refused(decided, { ...interim, reasonDigest: null })).toBe(true);
    expect(refused(decided, { ...interim, ruleId: null })).toBe(true);
    expect(refused(decided, { ...legal, legalReferenceDigest: null })).toBe(true);
    expect(refused(decided, { ...legal, ruleId: "R3" })).toBe(true);
  });

  test("a keyword goes only with the ground of the law", () => {
    expect(refused(decided, { ...final, categoryKeyword: "KEYWORD_TERRORIST_CONTENT" })).toBe(true);
    expect(refused(decided, { ...noAction, categoryKeyword: "KEYWORD_TERRORIST_CONTENT" })).toBe(true);
    expect(refused(decided, { ...legal, categoryKeyword: "KEYWORD_CHILD_SEXUAL_ABUSE_MATERIAL" })).toBe(true);
  });

  test("a correction names the decision it corrects, states no ground of its own, and holds reversals only; no other kind names a decision", () => {
    expect(refused(decided, { ...correction, reviewsDecisionId: null })).toBe(true);
    expect(refused(decided, { ...correction, reasonDigest: null })).toBe(true);
    expect(refused(decided, { ...correction, ground: "incompatible", ruleId: "R1" })).toBe(true);
    expect(refused(decided, { ...correction, ruleId: "R1" })).toBe(true);
    expect(refused(decided, { ...correction, factsDigest: hex })).toBe(true);
    expect(refused(decided, { ...correction, legalReferenceDigest: hex })).toBe(true);
    expect(refused(decided, { ...correction, categoryKeyword: "KEYWORD_TERRORIST_CONTENT" })).toBe(true);
    expect(refused(decided, { ...correction, actions: [{ kind: "withhold", mediaId: null }] })).toBe(true);
    expect(refused(decided, { ...correction, actions: [{ kind: "restore", mediaId: null }, { kind: "seal_media", mediaId: null }] })).toBe(true);
    expect(decided.parse({ ...correction, actions: [{ kind: "unseal_media", mediaId: null }] }).actions).toHaveLength(1);
    expect(refused(decided, { ...interim, reviewsDecisionId: uuid })).toBe(true);
    expect(refused(decided, { ...final, reviewsDecisionId: uuid })).toBe(true);
  });

  test("the actions are sorted by kind and then by image, without repeats, at most eight, with at most one post measure and one seal", () => {
    const sorted = [
      { kind: "remove", mediaId: null },
      { kind: "remove_media", mediaId: image },
      { kind: "remove_media", mediaId: otherImage },
      { kind: "seal_media", mediaId: null },
    ];
    const sealing = { ...final, ruleId: "R2", category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", actions: sorted };
    expect(decided.parse(sealing).actions).toEqual(sorted);
    // Any other order of the same actions, and any repeat, is refused: the same decision always has the same hash.
    expect(refused(decided, { ...sealing, actions: [sorted[1], sorted[0], sorted[2], sorted[3]] })).toBe(true);
    expect(refused(decided, { ...sealing, actions: [sorted[0], sorted[2], sorted[1], sorted[3]] })).toBe(true);
    expect(refused(decided, { ...sealing, actions: [sorted[0], sorted[1], sorted[1], sorted[3]] })).toBe(true);
    expect(refused(decided, { ...sealing, actions: [sorted[0], sorted[3], sorted[3]] })).toBe(true);
    expect(refused(decided, { ...interim, actions: [{ kind: "withhold", mediaId: null }, { kind: "withhold", mediaId: null }] })).toBe(true);
    // Two post measures in one decision.
    expect(refused(decided, { ...final, actions: [{ kind: "remove", mediaId: null }, { kind: "withhold", mediaId: null }] })).toBe(true);
    // Nine actions.
    const nine = Array.from({ length: 9 }, (_, i) => ({ kind: "remove_media", mediaId: `${i}a1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a` }));
    expect(refused(decided, { ...final, actions: nine })).toBe(true);
    expect(decided.parse({ ...final, actions: nine.slice(0, 8) }).actions).toHaveLength(8);
  });

  test("an image measure names its image, and no other kind names one", () => {
    expect(refused(decided, { ...interim, actions: [{ kind: "withhold_media", mediaId: null }] })).toBe(true);
    expect(refused(decided, { ...interim, actions: [{ kind: "withhold", mediaId: image }] })).toBe(true);
    expect(refused(decided, { ...final, actions: [{ kind: "seal_media", mediaId: image }] })).toBe(true);
    expect(refused(decided, { ...correction, actions: [{ kind: "restore_media", mediaId: null }] })).toBe(true);
    expect(decided.parse({ ...interim, actions: [{ kind: "withhold_media", mediaId: image }] }).actions[0]).toEqual({ kind: "withhold_media", mediaId: image });
  });

  test("appeals_reviewed takes the appeal, the snapshot, the outcome and reversals only, sorted like a decision's", () => {
    expect(reviewed.parse(review)).toEqual(review);
    everyFieldRequired(reviewed, review);
    expect(refused(reviewed, { ...review, actions: [{ kind: "remove", mediaId: null }] })).toBe(true);
    expect(refused(reviewed, { ...review, actions: [{ kind: "restore_media", mediaId: otherImage }, { kind: "restore_media", mediaId: image }] })).toBe(true);
    expect(refused(reviewed, { ...review, actions: [{ kind: "restore", mediaId: null }, { kind: "restore", mediaId: null }] })).toBe(true);
    expect(refused(reviewed, { ...review, appealId: uuid.toUpperCase() })).toBe(true);
    expect(refused(reviewed, { ...review, reasonDigest: null })).toBe(true);
    expect(reviewed.parse({ ...review, outcome: "partly_reversed", actions: [{ kind: "restore_media", mediaId: image }, { kind: "unseal_media", mediaId: null }] }).actions).toHaveLength(2);
  });

  // ---------------------------------------------------------------- 3e (design, section 10.4)
  const accountFinal = { ...final, ruleId: "R1" };
  const suspendAction = (days: number | null, announced: boolean) => ({ kind: "suspend", mediaId: null, days, announced });

  test("3e: an action entry is one of two strict shapes, and the three timed kinds sign their days and whether they are announced", () => {
    const announced = { ...accountFinal, actions: [suspendAction(3, true)] };
    expect(decided.parse(announced)).toEqual(announced);
    expect(decided.parse({ ...accountFinal, actions: [{ kind: "terminate", mediaId: null, days: null, announced: false }] }).actions).toHaveLength(1);
    expect(decided.parse({ ...accountFinal, ruleId: "R6", actions: [{ kind: "restrict_reporting", mediaId: null, days: 30, announced: false }] }).actions).toHaveLength(1);
    // A timed kind in the plain shape, and a plain kind in the timed one, are refused.
    expect(refused(decided, { ...accountFinal, actions: [{ kind: "suspend", mediaId: null }] })).toBe(true);
    expect(refused(decided, { ...accountFinal, actions: [{ kind: "remove", mediaId: null, days: 3, announced: true }] })).toBe(true);
    // days is a whole number from 1 to 30, null only on a termination; a restriction of reporting is never announced.
    for (const days of [0, 31, 1.5]) expect(refused(decided, { ...accountFinal, actions: [suspendAction(days, true)] }), String(days)).toBe(true);
    expect(refused(decided, { ...accountFinal, actions: [suspendAction(null, true)] })).toBe(true);
    expect(refused(decided, { ...accountFinal, actions: [{ kind: "terminate", mediaId: null, days: 3, announced: true }] })).toBe(true);
    expect(refused(decided, { ...accountFinal, ruleId: "R6", actions: [{ kind: "restrict_reporting", mediaId: null, days: 3, announced: true }] })).toBe(true);
    expect(refused(decided, { ...accountFinal, actions: [{ kind: "suspend", mediaId: image, days: 3, announced: true }] })).toBe(true);
    // At most one suspension or termination.
    expect(refused(decided, { ...accountFinal, actions: [suspendAction(3, true), { kind: "terminate", mediaId: null, days: null, announced: true }] })).toBe(true);
  });

  test("3e: the six measures only in a final restriction, a strike only on a korbat rule other than R2, an overruling only with a full reversal", () => {
    expect(decided.parse({ ...final, actions: [{ kind: "remove", mediaId: null }, { kind: "strike", mediaId: null }] }).actions).toHaveLength(2);
    expect(refused(decided, { ...interim, actions: [{ kind: "strike", mediaId: null }] })).toBe(true);
    expect(refused(decided, { ...noAction, actions: [{ kind: "retire_handle", mediaId: null }] })).toBe(true);
    expect(refused(decided, { ...legal, actions: [{ kind: "remove", mediaId: null }, { kind: "strike", mediaId: null }] })).toBe(true);
    expect(refused(decided, { ...final, ruleId: "R2", category: "STATEMENT_CATEGORY_PROTECTION_OF_MINORS", actions: [{ kind: "remove", mediaId: null }, { kind: "strike", mediaId: null }] })).toBe(true);
    const overruling = { ...correction, actions: [{ kind: "overrule", mediaId: null }, { kind: "restore", mediaId: null }] };
    expect(decided.parse(overruling).actions).toHaveLength(2);
    expect(refused(decided, { ...overruling, outcome: "partly_reversed" })).toBe(true);
    expect(reviewed.parse({ ...review, actions: overruling.actions }).actions).toHaveLength(2);
    expect(refused(reviewed, { ...review, outcome: "partly_reversed", actions: overruling.actions })).toBe(true);
    // A review and a correction hold the four new reversals, never a new measure.
    expect(refused(reviewed, { ...review, actions: [{ kind: "strike", mediaId: null }] })).toBe(true);
    expect(reviewed.parse({ ...review, actions: [{ kind: "lift_suspension", mediaId: null }] }).actions).toHaveLength(1);
  });

  test("3e: a correction may keep the decision with no action; unfounded only on a final no-breach decision, sorted; replaced only with a lift", () => {
    const kept = { ...correction, outcome: "kept", actions: [] };
    expect(decided.parse(kept).outcome).toBe("kept");
    expect(refused(decided, { ...kept, actions: [{ kind: "restore", mediaId: null }] })).toBe(true);
    expect(refused(decided, { ...final, outcome: "kept" })).toBe(true);
    const [first, second] = [uuid, "6f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a"].sort();
    expect(decided.parse({ ...noAction, unfounded: [first, second] }).unfounded).toEqual([first, second]);
    expect(refused(decided, { ...noAction, unfounded: [second, first] })).toBe(true);
    expect(refused(decided, { ...noAction, unfounded: [first, first] })).toBe(true);
    expect(refused(decided, { ...noAction, unfounded: [first!.toUpperCase()] })).toBe(true);
    expect(refused(decided, { ...final, unfounded: [first] })).toBe(true);
    expect(refused(decided, { ...noAction, unfounded: Array.from({ length: 101 }, (_, i) => `${String(i).padStart(8, "0")}-8d4a-4c1e-9b2a-6f0e5d4c3b2a`) })).toBe(true);
    const withdrawn = { ...correction, actions: [{ kind: "lift_suspension", mediaId: null }], replaced: true };
    expect(decided.parse(withdrawn).replaced).toBe(true);
    expect(refused(decided, { ...correction, replaced: true })).toBe(true);
    expect(refused(decided, { ...accountFinal, actions: [suspendAction(3, true)], replaced: true })).toBe(true);
    // Both members are always present: a decision without them is refused.
    const { unfounded: _u, ...withoutMarks } = interim;
    const { replaced: _r, ...withoutReplaced } = interim;
    expect(refused(decided, withoutMarks)).toBe(true);
    expect(refused(decided, withoutReplaced)).toBe(true);
  });

  test("identity_revealed takes a reason category and the digest of the saved reason, never the reason", () => {
    expect(revealed.parse(reveal)).toEqual(reveal);
    everyFieldRequired(revealed, reveal);
    for (const reasonCategory of ["impersonation_claim", "abuse_of_reporting", "legal_requirement", "other"]) expect(revealed.parse({ ...reveal, reasonCategory }).reasonCategory).toBe(reasonCategory);
    expect(refused(revealed, { ...reveal, reasonCategory: "curiosity" })).toBe(true);
    expect(refused(revealed, { ...reveal, reasonDigest: "because" })).toBe(true);
  });

  test("the cross-field rules survive the route's extension with the assertion, since its key does not overlap", () => {
    const extended = decided.extend({ stepUp: AuthenticationResponseJSON.optional() });
    expect(extended.parse({ ...interim, stepUp: assertion })).toEqual({ ...interim, stepUp: assertion });
    expect(extended.parse(interim)).toEqual(interim);
    expect(refused(extended, { ...interim, outcome: "no_violation", stepUp: assertion })).toBe(true);
    expect(refused(extended, { ...interim, throughSeq: 2, stepUp: assertion })).toBe(true);
    expect(refused(extended, { ...interim, other: 1, stepUp: assertion })).toBe(true);
    const extendedReview = reviewed.extend({ stepUp: AuthenticationResponseJSON.optional() });
    expect(refused(extendedReview, { ...review, actions: [{ kind: "remove", mediaId: null }], stepUp: assertion })).toBe(true);
    expect(extendedReview.parse({ ...review, stepUp: assertion }).stepUp).toEqual(assertion);
  });

  test("the options request takes each of the three with its own target and params", () => {
    const requests = [
      { action: "case_decided", target: { type: "case", id: uuid }, params: interim },
      { action: "appeals_reviewed", target: { type: "decision", id: uuid }, params: review },
      { action: "identity_revealed", target: { type: "intake_item", id: uuid }, params: reveal },
    ];
    for (const request of requests) expect(StaffStepUpOptionsRequest.parse(request), request.action).toEqual(request);
    expect(refused(StaffStepUpOptionsRequest, { ...requests[0], target: { type: "decision", id: uuid } })).toBe(true);
    expect(refused(StaffStepUpOptionsRequest, { ...requests[0], params: review })).toBe(true);
    expect(refused(StaffStepUpOptionsRequest, { ...requests[0], params: { ...interim, outcome: "kept" } })).toBe(true);
    expect(refused(StaffStepUpOptionsRequest, { ...requests[2], params: {} })).toBe(true);
  });

  /**
   * Every string a params schema lets through, by its path: the walk goes through objects, arrays and nullable members.
   * A string is described by its format (a uuid) and the patterns it is held to; enums and literals are closed lists and
   * numbers are not strings, so neither is listed.
   */
  function strings(schema: unknown, path = "$"): { path: string; format: string | undefined; patterns: string[] }[] {
    const def = (schema as { _zod: { def: Record<string, unknown> } })._zod.def;
    switch (def.type) {
      case "object":
        return Object.entries(def.shape as Record<string, unknown>).flatMap(([key, member]) => strings(member, `${path}.${key}`));
      case "array":
        return strings(def.element, `${path}[]`);
      case "nullable":
      case "optional":
        return strings(def.innerType, path);
      // 3e: an action entry is one of two shapes, each walked; a boolean and a null carry no text.
      case "union":
        return (def.options as unknown[]).flatMap((option) => strings(option, path));
      case "string": {
        const checks = ((def.checks as { _zod: { def: { format?: string; pattern?: RegExp } } }[] | undefined) ?? []).map((check) => check._zod.def);
        return [{ path, format: def.format as string | undefined, patterns: checks.filter((check) => check.format === "regex").map((check) => String(check.pattern)) }];
      }
      case "enum":
      case "literal":
      case "number":
      case "boolean":
      case "null":
        return [];
      default:
        // A kind of member this walk does not know could carry free text: it fails the test until it is listed above.
        return [{ path, format: `unknown member type ${String(def.type)}`, patterns: [] }];
    }
  }
  const LOWER_UUID = "/^[0-9a-f-]+$/";
  const HEX_DIGEST = "/^[0-9a-f]{64}$/";
  const free = (schema: unknown) => strings(schema).filter((s) => !((s.format === "uuid" && s.patterns.includes(LOWER_UUID)) || (s.format === undefined && s.patterns.includes(HEX_DIGEST))));

  test("no params schema of any action lets a free string through: every string is a lower-case uuid or a hex digest", () => {
    for (const [action, spec] of Object.entries(STAFF_STEP_UP_ACTIONS)) {
      expect(free(spec.params), action).toEqual([]);
      expect(free(spec.targetId), action).toEqual([]);
    }
    // What the walk finds in the decision's params: ids and digests, nothing else.
    expect(strings(decided).map((s) => s.path)).toEqual(["$.reviewsDecisionId", "$.snapshotId", "$.snapshotDigest", "$.actions[].mediaId", "$.factsDigest", "$.reasonDigest", "$.legalReferenceDigest", "$.unfounded[]"]);
    expect(strings(revealed).map((s) => s.path)).toEqual(["$.reasonDigest"]);
  });

  test("the walk catches a free string, a uuid in any case, a transform and a member it cannot read", () => {
    const loose = z.strictObject({
      note: z.string().max(10),
      id: z.uuid(),
      short: z.string().regex(/^[0-9a-f]{8}$/),
      list: z.array(z.strictObject({ label: z.string().nullable() })),
      trimmed: z.string().trim().pipe(z.uuid()),
      ok: z.uuid().regex(/^[0-9a-f-]+$/),
      digest: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    });
    expect(free(loose).map((s) => s.path)).toEqual(["$.note", "$.id", "$.short", "$.list[].label", "$.trimmed"]);
  });
});

describe("the step-up action's hash and binding", () => {
  const BS = String.fromCharCode(92);
  const LF = String.fromCharCode(10);
  const revoke = { action: "staff_session_revoked", target: { type: "staff_session", id: uuid }, params: {} };
  // The 3a action's sorted JSON, and the sha256 values below, were checked with Python's hashlib when they were written.
  const REVOKE_TEXT = `{"action":"staff_session_revoked","params":{},"target":{"id":"${uuid}","type":"staff_session"}}`;
  const REVOKE_HASH = "dad06ce5248ff75b3aa9b1faec9bab38bfa70f6dd2568d231b02e282207385c5";
  const SESSION = "8a3c7f0e-1111-4222-8333-944445555666";
  const BINDING = "9b70fa1ab475e7958d1265150cd04c7953483fe6145f52b12b2fd89d0c598dca";
  const hexOf = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  test("the action's text is the sorted JSON of its action, target and params: object keys sorted, no whitespace", () => {
    expect(stepUpActionText(revoke)).toBe(REVOKE_TEXT);
    // The order the members were written in changes nothing.
    expect(stepUpActionText({ params: {}, target: { id: uuid, type: "staff_session" }, action: "staff_session_revoked" })).toBe(REVOKE_TEXT);
    // The options request is hashed as it was sent: its schemas change nothing in it.
    expect(stepUpActionText(StaffStepUpOptionsRequest.parse(revoke))).toBe(REVOKE_TEXT);
  });

  test("params are sorted at every depth, arrays keep their order, and strings and numbers are written as JSON.stringify writes them", () => {
    const params = { b: [3, { z: 1, a: null }, "x"], a: `q"${BS}`, c: true, d: 0.5, e: -0, "": -1, B: { y: [], x: {} } };
    expect(stepUpActionText({ action: "case_decided", target: { type: "post", id: "p1" }, params })).toBe(
      `{"action":"case_decided","params":{"":-1,"B":{"x":{},"y":[]},"a":"q${BS}"${BS}${BS}","b":[3,{"a":null,"z":1},"x"],"c":true,"d":0.5,"e":0},"target":{"id":"p1","type":"post"}}`,
    );
  });

  test("keys are sorted by UTF-16 code units, as Array.prototype.sort sorts them in the API, audit-verify and the console alike", () => {
    const eAcute = String.fromCharCode(0xe9);
    const fullwidthA = String.fromCharCode(0xff21);
    // An astral character's first code unit (0xd83d) sorts before 0xff21, though its code point (0x1f600) is higher.
    const grinning = String.fromCodePoint(0x1f600);
    const params = { [fullwidthA]: 1, [grinning]: 2, [eAcute]: 3, z: 4 };
    expect(stepUpActionText({ action: "a", target: { type: "t", id: "i" }, params })).toBe(
      `{"action":"a","params":{"z":4,"${eAcute}":3,"${grinning}":2,"${fullwidthA}":1},"target":{"id":"i","type":"t"}}`,
    );
  });

  test("a value that is not JSON is refused rather than hashed", () => {
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, () => 1, BigInt(1), new Date(0), [undefined], Symbol("x")]) {
      expect(() => stepUpActionText({ action: "a", target: { type: "t", id: "i" }, params: { value } }), String(typeof value)).toThrow(TypeError);
    }
  });

  test("the action's hash is the lower-case hex sha256 of the text's UTF-8 bytes", async () => {
    expect(await stepUpActionHash(revoke)).toBe(REVOKE_HASH);
    const reason = String.fromCharCode(0xe9, 0x4e2d) + String.fromCodePoint(0x1f600);
    expect(await stepUpActionHash({ action: "case_decided", target: { type: "post", id: "p1" }, params: { reason } })).toBe(
      "8f41483850c87296607ff1c3fd5e501574bcc3f564a09d935a7063efab414720",
    );
  });

  test("another action, target or params gives another hash: params are bound too, though 3a's one action has none", async () => {
    const hashes = await Promise.all([
      stepUpActionHash(revoke),
      stepUpActionHash({ ...revoke, action: "staff_key_revoked" }),
      stepUpActionHash({ ...revoke, target: { type: "staff_session", id: "4f1c2b1e-8d4a-4c1e-9b2a-6f0e5d4c3b2a" } }),
      stepUpActionHash({ ...revoke, target: { type: "staff_key", id: uuid } }),
      stepUpActionHash({ ...revoke, params: { all: true } }),
      stepUpActionHash({ ...revoke, params: { all: false } }),
      stepUpActionHash({ ...revoke, params: { items: [1, 2] } }),
      stepUpActionHash({ ...revoke, params: { items: [2, 1] } }),
    ]);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  test("the binding is the full 32-byte sha256 of the session's handle, a newline and the action's hash", async () => {
    expect(stepUpBindingText(SESSION, REVOKE_HASH)).toBe(`${SESSION}${LF}${REVOKE_HASH}`);
    const binding = await stepUpBinding(SESSION, REVOKE_HASH);
    expect(binding).toBeInstanceOf(Uint8Array);
    expect(binding).toHaveLength(32);
    expect(hexOf(binding)).toBe(BINDING);
    // Another session, or another action, binds something else.
    expect(hexOf(await stepUpBinding("7e2d9a10-6c3b-4f5e-8a21-0d4c7b9e1f36", REVOKE_HASH))).not.toBe(BINDING);
    expect(hexOf(await stepUpBinding(SESSION, "0".repeat(64)))).not.toBe(BINDING);
  });

  test("the step-up challenge's layout: 74 bytes of version, purpose, expiry, nonce, the full binding and the seal", () => {
    expect(STAFF_STEP_UP_CHALLENGE).toEqual({
      bytes: 74,
      encodedLength: 99,
      version: 1,
      purpose: 6,
      versionAt: 0,
      purposeAt: 1,
      expiryAt: 2,
      expiryBytes: 8,
      nonceAt: 10,
      nonceBytes: 16,
      bindingAt: 26,
      bindingBytes: 32,
      sealAt: 58,
      sealBytes: 16,
    });
    // The fields follow one another with no gap, and the encoded length is the bytes' unpadded base64url length.
    const c = STAFF_STEP_UP_CHALLENGE;
    expect([c.purposeAt + 1, c.expiryAt + c.expiryBytes, c.nonceAt + c.nonceBytes, c.bindingAt + c.bindingBytes, c.sealAt + c.sealBytes]).toEqual([
      c.expiryAt,
      c.nonceAt,
      c.bindingAt,
      c.sealAt,
      c.bytes,
    ]);
    expect(c.encodedLength).toBe(Math.ceil((c.bytes * 8) / 6));
  });

  test("the other ceremonies' layout: 58 bytes of version, purpose, expiry, nonce, a 16-byte binding and the seal", () => {
    expect(CEREMONY_CHALLENGE).toEqual({
      bytes: 58,
      encodedLength: 78,
      version: 1,
      versionAt: 0,
      purposeAt: 1,
      expiryAt: 2,
      expiryBytes: 8,
      nonceAt: 10,
      nonceBytes: 16,
      bindingAt: 26,
      bindingBytes: 16,
      sealAt: 42,
      sealBytes: 16,
    });
    const c = CEREMONY_CHALLENGE;
    expect([c.purposeAt + 1, c.expiryAt + c.expiryBytes, c.nonceAt + c.nonceBytes, c.bindingAt + c.bindingBytes, c.sealAt + c.sealBytes]).toEqual([
      c.expiryAt,
      c.nonceAt,
      c.bindingAt,
      c.sealAt,
      c.bytes,
    ]);
    expect(c.encodedLength).toBe(Math.ceil((c.bytes * 8) / 6));
    // The two layouts share their first fields, and their lengths keep either from being read as the other.
    expect([c.versionAt, c.purposeAt, c.expiryAt, c.nonceAt, c.bindingAt, c.version]).toEqual([
      STAFF_STEP_UP_CHALLENGE.versionAt,
      STAFF_STEP_UP_CHALLENGE.purposeAt,
      STAFF_STEP_UP_CHALLENGE.expiryAt,
      STAFF_STEP_UP_CHALLENGE.nonceAt,
      STAFF_STEP_UP_CHALLENGE.bindingAt,
      STAFF_STEP_UP_CHALLENGE.version,
    ]);
    expect(c.bytes).not.toBe(STAFF_STEP_UP_CHALLENGE.bytes);
  });

  test("each ceremony's purpose code, the step-up's among them, and no two alike", () => {
    expect(CHALLENGE_PURPOSES).toEqual({ signin: 1, register: 2, reauth: 3, staff_signin: 4, staff_register: 5, staff_step_up: 6 });
    expect(STAFF_STEP_UP_CHALLENGE.purpose).toBe(CHALLENGE_PURPOSES.staff_step_up);
    expect(new Set(Object.values(CHALLENGE_PURPOSES)).size).toBe(Object.keys(CHALLENGE_PURPOSES).length);
  });
});

describe("the audit log", () => {
  const entry = {
    seq: 42,
    hash: hex,
    createdAt: at,
    actorHandle: "mod_ada",
    action: "staff_session_revoked",
    targetType: "staff_session",
    targetId: uuid,
    actionHash: "cd".repeat(32),
  };

  test("an entry carries its place and hash, time, actor handle, action, target and the action's hash", () => {
    expect(AuditEntry.parse(entry)).toEqual(entry);
    // The system actor has no handle; most rows have no step-up, some no target.
    const bare = { ...entry, actorHandle: null, targetType: null, targetId: null, actionHash: null };
    expect(AuditEntry.parse(bare)).toEqual(bare);
    everyFieldRequired(AuditEntry, entry);
  });

  test("an entry never carries metadata, and its place and hashes have their exact forms", () => {
    expect(AuditEntry.parse({ ...entry, metadata: { email: "a@b.c" } })).toEqual(entry);
    for (const seq of [0, -1, 1.5, "42"]) expect(AuditEntry.safeParse({ ...entry, seq }).success, String(seq)).toBe(false);
    for (const hash of ["AB".repeat(32), "ab".repeat(31), `${"ab".repeat(31)}zz`]) {
      expect(AuditEntry.safeParse({ ...entry, hash }).success, hash).toBe(false);
      expect(AuditEntry.safeParse({ ...entry, actionHash: hash }).success, hash).toBe(false);
    }
  });

  test("a page holds at most 50 entries and the cursor of the next one, null at the end", () => {
    expect(STAFF_AUDIT_PAGE_SIZE).toBe(50);
    expect(AuditPage.parse({ entries: [entry], nextCursor: 42 })).toEqual({ entries: [entry], nextCursor: 42 });
    expect(AuditPage.parse({ entries: [], nextCursor: null })).toEqual({ entries: [], nextCursor: null });
    expect(AuditPage.safeParse({ entries: Array(51).fill(entry), nextCursor: null }).success).toBe(false);
    expect(AuditPage.safeParse({ entries: Array(50).fill(entry), nextCursor: 1 }).success).toBe(true);
    expect(AuditPage.safeParse({ entries: [entry] }).success).toBe(false);
    expect(AuditPage.safeParse({ entries: [entry], nextCursor: 0 }).success).toBe(false);
  });

  test("a page is asked for by cursor, by place (at) or from the newest, with sign-ins as the one filter", () => {
    expect(AuditPageQuery.parse({})).toEqual({});
    expect(AuditPageQuery.parse({ cursor: "42" })).toEqual({ cursor: 42 });
    expect(AuditPageQuery.parse({ at: "7", action: "staff_sign_in" })).toEqual({ at: 7, action: "staff_sign_in" });
    expect(AuditPageQuery.parse({ cursor: "999999999999999" }).cursor).toBe(999_999_999_999_999);
    for (const value of ["0", "-1", "1.5", "01", "1e3", "", " 4", "abc", "1000000000000000"]) {
      expect(AuditPageQuery.safeParse({ cursor: value }).success, value).toBe(false);
      expect(AuditPageQuery.safeParse({ at: value }).success, value).toBe(false);
    }
    expect(AuditPageQuery.safeParse({ action: "role_granted" }).success).toBe(false);
    // A cursor reads older rows and at reads from a place: both at once name no page.
    expect(AuditPageQuery.safeParse({ cursor: "4", at: "7" }).success).toBe(false);
  });
});
