import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AppealReviewRequest,
  CaseDecidedParams,
  CaseDecisionRequest,
  CEREMONY_CHALLENGE,
  CHALLENGE_PURPOSES,
  FindingRequest,
  IdentityRevealRequest,
  MEASURES,
  RULE_DEFAULT_CATEGORY,
  STANDING_RULES,
  STAFF_AUDIT_PAGE_SIZE,
  STAFF_STEP_UP_CHALLENGE,
  StaffEnrollOptionsRequest,
  StaffEnrollVerifyRequest,
  StaffSessionRevokeRequest,
  StaffSignInVerifyRequest,
  StaffStepUpOptionsRequest,
  StaffTextSaveRequest,
  snapshotDigest,
  stepUpActionHash,
  stepUpBinding,
  textDigest,
  type AppealRow,
  type AppealsPage,
  type AppealsReviewedParams,
  type AuditEntry,
  type AuditPage,
  type CaseDecision,
  type CaseView,
  type QueuePage,
  type StaffTextDraft,
  type StaffKey,
  type StaffMe,
  type StaffErrorCode,
  type StaffSession,
  type StaffStepUpActionInput,
} from "@korbat/contracts";
import type { z } from "zod";
import {
  accountCase,
  ACCOUNT_DECLINE,
  ACCOUNT_SEALABLE,
  adminCase,
  appealedCase,
  CASE_ACCOUNT,
  CASE_ADMIN,
  CASE_APPEALED,
  CASE_CHANGED,
  CASE_DECLINE,
  CASE_DRAFTS,
  CASE_FROZEN,
  CASE_POST,
  CASE_QUOTED,
  CASE_SEALABLE,
  CASE_STRIKE,
  frozenCase,
  LONGEST_EXPLANATION,
  LONGEST_NOTE,
  LOOKALIKE,
  NO_STANDING,
  overview,
  plainCase,
  postCase,
  QUEUE_ROWS,
  sealableCase,
  strikeCase,
} from "../case-fixtures";
import { HOSTILE } from "../fixtures";

/**
 * The staff API as the browser check answers it (3a design, section 12): no database and no API process, only answers
 * from fixtures held in memory, shaped by the contracts, whose user-written strings are hostile. It checks what a real
 * browser sends, as far as the console's part goes: the staff gate's Host, Origin and fetch metadata, the staff CSRF
 * header on every write, the WebAuthn ceremonies' client data (type, challenge, origin) and the authenticator's flags
 * (user verified, never backup-eligible or backed up). Anything the page sent that the real API would refuse for the
 * page's own fault is listed in `problems`. Signatures are not verified: the API's own tests do that with its library.
 *
 * A decision (3c design, section 7.5) is checked as far as the page's own part goes: the assertion was made over a
 * challenge bound to exactly the params the request carries, the snapshot it names is the case's newest with the digest
 * of what the page was shown, recomputed here, and each text it names is one the page saved on that case. The case is
 * then changed as the decision says, and answered as it now stands.
 *
 * A review (section 7.7) is checked the same way: the assertion was made over a challenge bound to exactly this review of
 * exactly this decision, its appeal is the decision's pending one, its snapshot the case's newest as shown, and its
 * reason one the page saved on that case. The appeals' list answers what waits in the fixtures' cases, without a
 * statement.
 *
 * A text is saved without the key (section 7.4), also when its field loses focus: every save is kept, so the walk counts
 * them, and a case's answer carries the person's saved texts that no decision has named yet, as the API's does, so that a
 * reload brings them back. A step of the walk can have the next save refused, a case decided by another staff member
 * behind the page, the person made an admin, and a saved draft answered with other words under its digest.
 */

/** The longest handle an account can choose (checkHandle: 3 to 20 of a-z, 0-9 and _). */
export const LONGEST_HANDLE = "h".repeat(20);

/** The name typed for the new key at enrolment: markup, within the display-name rules the page checks it against. */
export const TYPED_KEY_NAME = '"><img src=x onerror=alert(9)>';

/** The signed-in person's handle, and the browser labels of their sessions, as an API made to echo them would send them. */
export const PERSON_HANDLE = HOSTILE.script;
export const CURRENT_BROWSER = HOSTILE.url;
export const OTHER_BROWSERS = [HOSTILE.img, HOSTILE.bidi] as const;
/** The keys the person already holds, by name: the longest name allowed (50 characters), and more markup. */
export const EXISTING_KEY_NAMES = [HOSTILE.long, HOSTILE.quote] as const;
/** The handles the audit log's rows name, in turn; null is the system actor. */
export const ACTOR_HANDLES = [HOSTILE.script, HOSTILE.img, HOSTILE.url, HOSTILE.quote, HOSTILE.bidi, LONGEST_HANDLE, null] as const;

/** The handle the fixtures reveal for a reporter (hostile, and found nowhere else on a page), and the note the walk types on a case. */
export const REVEALED_HANDLE = '"><a href="javascript:alert(5)">a_reporter</a>';
export const TYPED_NOTE = `Art. 18 check: no suspicion ${HOSTILE.img}`;
/** A link the finding form is given that names nothing live. */
export const DEAD_LINK = "http://localhost:8081/post/00000000-0000-4000-8000-000000000000";
/** The reason a forged save answer stands for: one the person never wrote. */
export const FORGED_REASON = "A reason this server wrote in the person's name.";
/** What the walk types into the composer: the reason of a correction, the facts of a decision, and why it does not seal. Each holds markup. */
export const TYPED_REASON = `The withhold was taken on the wrong post ${HOSTILE.img}`;
export const TYPED_FACTS = `The post offers followers for money ${HOSTILE.quote}`;
export const TYPED_REVIEW_REASON = `The rule does not cover a quotation ${HOSTILE.quote}`;
export const TYPED_DECLINE = `The report repeats one that was answered ${HOSTILE.script}`;
/** The facts of an admin's answer without a measure, of a decision on a case that changed, and of a draft a reload brings back. Each holds markup. */
export const TYPED_ADMIN_FACTS = `The report's words give no concrete reason to believe it ${HOSTILE.img}`;
export const TYPED_CHANGED_FACTS = `The post sells followers ${HOSTILE.script}`;
export const TYPED_DRAFT_FACTS = `The post repeats one link forty times ${HOSTILE.quote}`;
/** The other staff member who decides a case behind the page, by handle. */
export const OTHER_STAFF = HOSTILE.bidi;
/** The words a forged draft carries in place of the person's own, under the digest of what they saved. */
export const FORGED_DRAFT = "Words this server put into the draft of its person.";

/**
 * Every user-written string the console must show as text, exactly as written: 3a's handles, names and labels, and of the
 * cases a text made to look like the console's own line, the longest explanation, the longest note, and what the walk
 * itself types into a note, a correction, a decision and a choice not to seal.
 */
export const HOSTILE_TEXTS = [
  ...new Set([
    PERSON_HANDLE,
    CURRENT_BROWSER,
    ...OTHER_BROWSERS,
    ...EXISTING_KEY_NAMES,
    TYPED_KEY_NAME,
    ...ACTOR_HANDLES.filter((h) => h !== null),
    LOOKALIKE.label,
    LONGEST_EXPLANATION,
    LONGEST_NOTE,
    TYPED_NOTE,
    REVEALED_HANDLE,
    TYPED_REASON,
    TYPED_REVIEW_REASON,
    TYPED_FACTS,
    TYPED_DECLINE,
    TYPED_ADMIN_FACTS,
    TYPED_CHANGED_FACTS,
    TYPED_DRAFT_FACTS,
  ]),
];

/**
 * A WebP of 2 by 2 pixels (lossless, 38 bytes), which the fixtures answer for every image of a case: a real image, so the
 * browser decodes it under the console's policy as it would a stored one.
 */
export const FIXTURE_WEBP = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQvOIVr/+BiOh/AAA=", "base64");

/** An image request of a case, as the console's one image site builds it. */
export const IMAGE_PATH = /^\/api\/staff\/cases\/([0-9a-f-]{36})\/media\/([0-9a-f-]{36})\/(small|large)$/;

const HOUR = 60 * 60_000;
const IDLE_MS = 15 * 60_000;
const ABSOLUTE_MS = 12 * HOUR;
/** How far apart the audit log's rows are: 97 minutes, so none sits within an hour of the home screen's 7-day edge. */
const ROW_SPACING_MS = 97 * 60_000;
const AUDIT_ROWS = 160;

/** The authenticator data's flags (WebAuthn L3, section 6.1). */
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;

const iso = (ms: number) => new Date(ms).toISOString();
const hex64 = () => randomBytes(32).toString("hex");
const b64url = (bytes: number) => randomBytes(bytes).toString("base64url");

interface KeyRecord extends StaffKey {
  /** The credential the browser made; null for the keys the person held before the walk, which no authenticator holds. */
  credentialId: string | null;
}

interface SessionRecord {
  handle: string;
  token: string;
  csrf: string;
  browser: string;
  createdAt: number;
  lastUsedAt: number;
  /** The credential of the key that opened it; null for the fixtures' other sessions. */
  credentialId: string | null;
}

export interface RequestRecord {
  method: string;
  path: string;
  status: number;
  activity: boolean;
}

/**
 * The audit log: places 1 to 160, one row every 97 minutes up to now, so the newest page, Load older and Go to place each
 * have rows to show, and the home screen's sign-ins reach back past 7 days. Actions, targets and actors take hostile
 * values in turn.
 */
function auditLog(now: number): AuditEntry[] {
  const rows: AuditEntry[] = [];
  for (let seq = AUDIT_ROWS; seq >= 1; seq--) {
    const kind = seq % 4 === 0 ? "revoked" : seq % 9 === 0 ? "hostile" : "signin";
    rows.push({
      seq,
      hash: hex64(),
      createdAt: iso(now - (AUDIT_ROWS - seq) * ROW_SPACING_MS),
      actorHandle: ACTOR_HANDLES[seq % ACTOR_HANDLES.length] ?? null,
      action: kind === "revoked" ? "staff_session_revoked" : kind === "hostile" ? HOSTILE.script : "staff_sign_in",
      targetType: kind === "revoked" ? "staff_session" : kind === "hostile" ? HOSTILE.quote : null,
      targetId: kind === "revoked" ? randomUUID() : kind === "hostile" ? HOSTILE.url : null,
      actionHash: kind === "revoked" ? hex64() : null,
    });
  }
  return rows;
}

/** The authenticator data inside a CBOR attestation object: the byte string under the text key "authData". */
function authDataOf(attestationObject: Buffer): Buffer | null {
  // A CBOR text string of 8 bytes (0x68) spelling authData, then the byte string (major type 2) it maps to.
  const key = Buffer.concat([Buffer.from([0x68]), Buffer.from("authData")]);
  const at = attestationObject.indexOf(key);
  if (at === -1) return null;
  let i = at + key.length;
  const head = attestationObject[i];
  if (head === undefined || head >> 5 !== 2) return null;
  let length = head & 0x1f;
  i += 1;
  // The length is in the head itself, or in the 1, 2 or 4 bytes after it.
  if (length === 24) {
    length = attestationObject.readUInt8(i);
    i += 1;
  } else if (length === 25) {
    length = attestationObject.readUInt16BE(i);
    i += 2;
  } else if (length === 26) {
    length = attestationObject.readUInt32BE(i);
    i += 4;
  } else if (length > 23) {
    return null;
  }
  return attestationObject.subarray(i, i + length);
}

/** The flags byte of authenticator data, which follows the 32-byte hash of the relying party ID. */
const flagsOf = (authData: Buffer | null): number | null => (authData && authData.length > 32 ? authData[32]! : null);

/** The staff refusal for an authenticator's flags, or null: user verified, and neither backup-eligible nor backed up. */
function flagRefusal(flags: number | null): "staff_key_refused" | "staff_key_not_user_verified" | "staff_key_not_device_bound" | null {
  if (flags === null) return "staff_key_refused";
  if ((flags & FLAG_UV) === 0) return "staff_key_not_user_verified";
  if ((flags & (FLAG_BE | FLAG_BS)) !== 0) return "staff_key_not_device_bound";
  return null;
}

function cookies(req: IncomingMessage): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) jar.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return jar;
}

/** The staff cookies as the API sets them: __Host- names, Secure, Path=/, SameSite=Strict, 12 hours, the session's HttpOnly. */
const COOKIE = "Path=/; Secure; SameSite=Strict";
const SESSION_COOKIE = "__Host-korbat_staff";
const CSRF_COOKIE = "__Host-korbat_staff_csrf";
const CLEAR_COOKIES = [`${SESSION_COOKIE}=; ${COOKIE}; HttpOnly; Max-Age=0`, `${CSRF_COOKIE}=; ${COOKIE}; Max-Age=0`];

/**
 * The status the API answers each staff refusal with (apps/api/src/auth/staff/), so the console meets here what it meets
 * behind Caddy; a unit test (fixture-statuses.test.ts) checks it against the API's own source.
 */
export const REFUSAL_STATUS = {
  staff_enrollment_invalid: 400,
  staff_key_refused: 400,
  staff_key_invalid: 401,
  staff_session_required: 401,
  staff_key_not_user_verified: 403,
  staff_key_not_device_bound: 403,
  staff_key_suspended: 403,
  staff_step_up_required: 403,
  staff_step_up_invalid: 403,
  staff_key_limit: 409,
} as const satisfies Record<StaffErrorCode, number>;

class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly headers: Record<string, string | string[]> = {},
  ) {
    super(code);
  }
}

/** A staff refusal with the API's own status for its code. */
const refuse = (code: StaffErrorCode, headers: Record<string, string | string[]> = {}) => new Refusal(REFUSAL_STATUS[code], code, headers);

/**
 * A challenge in the other ceremonies' 58-byte layout (the contracts' CEREMONY_CHALLENGE), with the purpose's code, a
 * fresh nonce, `binding` (zeros for a sign-in, bound to nothing) and a random seal, since only this server reads it back.
 */
function ceremonyChallenge(purpose: "staff_signin" | "staff_register", binding: Buffer = Buffer.alloc(CEREMONY_CHALLENGE.bindingBytes)): string {
  const c = CEREMONY_CHALLENGE;
  const bytes = randomBytes(c.bytes);
  bytes[c.versionAt] = c.version;
  bytes[c.purposeAt] = CHALLENGE_PURPOSES[purpose];
  bytes.writeBigUInt64BE(BigInt(Date.now() + 10 * 60_000), c.expiryAt);
  binding.copy(bytes, c.bindingAt);
  return bytes.toString("base64url");
}

/**
 * The status the API answers each moderation refusal the fixtures use with (apps/api/src/moderation/context.ts); the
 * unit test that holds the staff statuses to the API's source holds these too.
 */
export const MODERATION_REFUSAL_STATUS = { text_not_found: 409, text_invalid: 422, text_quotes_user: 422, rate_limited: 429, image_refused: 404, staff_recused: 403, case_changed: 409, snapshot_mismatch: 409, reviewer_conflict: 403, strike_mismatch: 409 } as const;

/** The kinds of text a decision or a correction names: the ones a case's answer hands back as drafts while no decision has named them. */
const DRAFT_KINDS: readonly string[] = ["facts", "reason", "legal_reference", "review_reason"];

/** What an item reads once a decision answered it. */
const ITEM_OUTCOMES = { restricted: { incompatible: "restricted_rule", illegal: "restricted_legal" }, no_violation: "no_violation", not_evident: "not_evident" } as const;

/**
 * 3e (design, sections 7.4 and 7.11): what the database holds a decision's strike and its overruling to, as a problem's
 * words or null. A final restriction under a korbat rule other than R2 that answers no suspect item gives a strike
 * exactly when the case's answer said one is due; a correction or a review overrules the strike of the decision it
 * reverses exactly when it reverses that decision whole, and never signs a strike.
 */
function strikeProblem(view: CaseView, kind: string, outcome: string, ground: string | null, ruleId: string | null, actions: readonly { kind: string }[], reviewed: CaseDecision | undefined): string | null {
  const strikes = actions.some((action) => action.kind === "strike");
  const overrules = actions.some((action) => action.kind === "overrule");
  if (kind === "correction" || kind === "review") {
    if (strikes) return "a strike signed with a reversal";
    const standing = reviewed?.actions.some((action) => action.kind === "strike" && action.inForce) ?? false;
    return overrules !== (standing && outcome === "reversed") ? "an overruling that the reversal does not bear out" : null;
  }
  if (overrules) return "an overruling signed with a decision that reverses nothing";
  const suspect = view.items.some((item) => item.outcome === null && item.suspect);
  const due = kind === "final" && outcome === "restricted" && ground === "incompatible" && ruleId !== "R2" && !suspect && (view.strikeDue?.due ?? false);
  return strikes !== due ? "a strike the case's answer did not say is due, or none where it said one is" : null;
}

/** The author's band of active strikes once a decision gave one more. */
const NEXT_BAND = { "0": "1", "1": "2", "2": "3_or_more", "3_or_more": "3_or_more" } as const;

/**
 * The case as a confirmed decision leaves it, changed in place: the decision with its measures in the case's list and
 * history, the next version, a lifted measure no longer in force, a seal with what the case reaches, and after a final
 * decision the items it answered, the measures taken while deciding ended, and the case closed when nothing is left open.
 */
function applyDecision(view: CaseView, params: CaseDecidedParams, written: { facts: string | null; reason: string | null; legalReference: string | null }, staffHandle: string): void {
  const at = new Date().toISOString();
  const id = randomUUID();
  const corrected = view.decisions.find((decided) => decided.id === params.reviewsDecisionId);
  const actions: CaseDecision["actions"] = params.actions.map((action) => {
    const lifts: readonly string[] | null = MEASURES[action.kind].lifts;
    if (lifts !== null) {
      const lifted = corrected?.actions.find((held) => held.inForce && lifts.includes(held.kind) && held.mediaId === action.mediaId);
      if (lifted) {
        lifted.inForce = false;
        lifted.liftedBy = id;
      }
      return { id: randomUUID(), kind: action.kind, mediaId: action.mediaId, noEffect: null, inForce: false, reversesActionId: lifted?.id ?? null, liftedBy: null, sealed: null, ...NO_STANDING };
    }
    const reach = view.suspicion?.reach ?? { posts: 0, images: 0 };
    const sealed = action.kind === "seal_media" ? { posts: reach.posts, images: reach.images, deletedPosts: 0, list: [] } : null;
    // 3e: a strike counts STANDING_RULES.strikeDays from its decision, and nothing rests on it yet.
    const strike = action.kind === "strike" ? { countsUntil: new Date(Date.parse(at) + STANDING_RULES.strikeDays * 86_400_000).toISOString(), restedOnBy: [] } : {};
    return { id: randomUUID(), kind: action.kind, mediaId: action.mediaId, noEffect: null, inForce: true, reversesActionId: null, liftedBy: null, sealed, ...NO_STANDING, ...strike };
  });
  const suspect = view.items.some((item) => item.outcome === null && item.suspect);
  view.decisions = [
    ...view.decisions,
    {
      id,
      kind: params.kind,
      outcome: params.outcome,
      ground: params.ground,
      ruleId: params.ruleId,
      rulesVersion: params.rulesVersion,
      redressVersion: params.redressVersion,
      category: params.category,
      categoryKeyword: params.categoryKeyword,
      source: "report",
      decidedAt: at,
      staffHandle,
      throughSeq: params.throughSeq,
      answersFromSeq: params.kind === "final" ? view.answeredSeq + 1 : null,
      reviewsDecisionId: params.reviewsDecisionId,
      snapshotId: params.snapshotId,
      suspect,
      unseen: false,
      needsAdmin: false,
      endedInterim: false,
      facts: written.facts,
      reason: written.reason,
      legalReference: written.legalReference,
      actions,
    },
  ];
  view.history = [...view.history, { at, event: "decision", refId: id, seq: null, intakeKind: null, ruleId: null, allegesIllegal: null, csam: null, reexamination: null, decisionKind: params.kind, outcome: params.outcome, staffHandle, result: null }];
  view.stateVersion += 1;
  // 3e: the post now carries a strike that stands, and its author has one more.
  if (actions.some((action) => action.kind === "strike")) {
    view.strikeDue = { due: false, why: "already_struck" };
    if (view.authorStanding) view.authorStanding = { ...view.authorStanding, activeStrikes: NEXT_BAND[view.authorStanding.activeStrikes] };
  }
  if (actions.some((action) => action.kind === "seal_media") && view.suspicion) view.suspicion = { ...view.suspicion, reach: { ...view.suspicion.reach, sealed: view.suspicion.reach.images, served: 0 } };
  if (params.kind !== "final" || (params.outcome !== "restricted" && params.outcome !== "no_violation" && params.outcome !== "not_evident")) return;
  const outcome = params.outcome === "restricted" ? ITEM_OUTCOMES.restricted[params.ground ?? "incompatible"] : ITEM_OUTCOMES[params.outcome];
  view.items = view.items.map((item) => (item.outcome === null && item.seq <= params.throughSeq ? { ...item, outcome, answeredBy: id } : item));
  view.answeredSeq = params.throughSeq;
  if (view.items.some((item) => item.outcome === null)) return;
  // The case is closed: what was done while deciding has ended, and the post reads as the decision's measure left it.
  view.closedAt = at;
  for (const decided of view.decisions) if (decided.kind === "interim") for (const action of decided.actions) if (MEASURES[action.kind].lifts === null) action.inForce = false;
  if (view.target.type === "post" && actions.some((action) => action.kind === "remove")) view.target = { ...view.target, state: "removed", level: "removed" };
}

/**
 * The case as a confirmed review leaves it, changed in place: the review with its reversals in the case's list and
 * history, the measures it lifts no longer in force, the appeal answered, the next version, and a post whose removal was
 * lifted shown again.
 */
function applyReview(view: CaseView, reviewed: CaseDecision, params: AppealsReviewedParams, reason: string, staffHandle: string): void {
  const at = new Date().toISOString();
  const id = randomUUID();
  const actions: CaseDecision["actions"] = params.actions.map((action) => {
    const lifts: readonly string[] = MEASURES[action.kind].lifts ?? [];
    const lifted = reviewed.actions.find((held) => held.inForce && lifts.includes(held.kind) && held.mediaId === action.mediaId);
    if (lifted) {
      lifted.inForce = false;
      lifted.liftedBy = id;
    }
    return { id: randomUUID(), kind: action.kind, mediaId: action.mediaId, noEffect: null, inForce: false, reversesActionId: lifted?.id ?? null, liftedBy: null, sealed: null, ...NO_STANDING };
  });
  view.decisions = [
    ...view.decisions,
    {
      id,
      kind: "review",
      outcome: params.outcome,
      ground: null,
      ruleId: null,
      rulesVersion: params.rulesVersion,
      redressVersion: params.redressVersion,
      category: params.category,
      categoryKeyword: null,
      source: reviewed.source,
      decidedAt: at,
      staffHandle,
      throughSeq: 0,
      answersFromSeq: null,
      reviewsDecisionId: reviewed.id,
      snapshotId: params.snapshotId,
      suspect: reviewed.suspect,
      unseen: false,
      needsAdmin: false,
      endedInterim: false,
      facts: null,
      reason,
      legalReference: null,
      actions,
    },
  ];
  view.appeals = view.appeals.map((appeal) => (appeal.id === params.appealId ? { ...appeal, answeredAt: at, result: params.outcome, answeredBy: id, reviewer: null, mayReview: false } : appeal));
  view.history = [
    ...view.history,
    { at, event: "decision", refId: id, seq: null, intakeKind: null, ruleId: null, allegesIllegal: null, csam: null, reexamination: null, decisionKind: "review", outcome: params.outcome, staffHandle, result: null },
    { at, event: "appeal_answered", refId: params.appealId, seq: null, intakeKind: null, ruleId: null, allegesIllegal: null, csam: null, reexamination: null, decisionKind: null, outcome: null, staffHandle: null, result: params.outcome },
  ];
  view.stateVersion += 1;
  if (view.target.type === "post" && actions.some((action) => action.kind === "restore")) view.target = { ...view.target, state: "visible", level: "visible" };
}

/** `raw` answers bytes of this type in place of JSON: an image. */
type Answer = { status: number; body?: unknown; raw?: { type: string; bytes: Buffer }; headers?: Record<string, string | string[]> };

export type FixtureApi = ReturnType<typeof createFixtureApi>;

export function createFixtureApi() {
  const now = Date.now();
  // The account's WebAuthn user handle, which the enrolment's options carry and a discoverable staff key returns.
  const userHandle = b64url(32);
  const state = {
    /** The origin the page is served from, set once the server listens. */
    origin: "",
    /** The console is off: every staff path answers 404, as the API does while CONSOLE_ORIGIN is unset. */
    off: false,
    enrolmentToken: b64url(32),
    enrolmentUsed: false,
    /** The next step-up options bind another action than the one the page asked for: the revocation of another session. */
    mismatchNextStepUp: false,
    /**
     * The next sign-in options carry a step-up challenge for an action of this server's choosing, as an API under an
     * attacker's control would hand out to have the key sign it at an ordinary sign-in.
     */
    stepUpChallengeAtNextSignIn: false,
    signInOptionsServed: 0,
    keys: EXISTING_KEY_NAMES.map(
      (name, i): KeyRecord => ({ id: randomUUID(), name, createdAt: iso(now - (30 + i) * 24 * HOUR), lastUsedAt: i === 0 ? iso(now - 2 * HOUR) : null, credentialId: null }),
    ),
    sessions: new Map<string, SessionRecord>(),
    audit: auditLog(now),
    /** Challenges handed out and not yet spent, by their base64url text: what each was issued for, a step-up's with the hash of the action it binds. */
    challenges: new Map<string, { purpose: "register" | "signin" | "step_up"; target?: string; hash?: string }>(),
    /** The handles the page revoked with its key. */
    revoked: [] as string[],
    /** The cases the console can open: a post's, a frozen post's, an account's, and the one a quoting post links to. */
    cases: new Map<string, CaseView>([
      [CASE_POST, postCase()],
      [CASE_FROZEN, frozenCase()],
      [CASE_ACCOUNT, accountCase()],
      [CASE_QUOTED, postCase({ id: CASE_QUOTED, items: [], decisions: [], notes: [] })],
      [CASE_SEALABLE, sealableCase(CASE_SEALABLE, ACCOUNT_SEALABLE)],
      [CASE_DECLINE, sealableCase(CASE_DECLINE, ACCOUNT_DECLINE)],
      [CASE_ADMIN, adminCase()],
      [CASE_CHANGED, plainCase(CASE_CHANGED, "f5d8e7da-4906-48da-91e6-25c413a8f7e1")],
      [CASE_DRAFTS, plainCase(CASE_DRAFTS, "f5d8e7da-4906-48da-91e6-25c413a8f7e2")],
      [CASE_APPEALED, appealedCase()],
      // 3e: the case of the run that signs a strike.
      [CASE_STRIKE, strikeCase()],
    ]),
    /** The role the signed-in person holds: a moderator, unless a step of the walk makes them an admin. */
    role: "moderator" as StaffMe["role"],
    /** Every decision the key confirmed: the case and the params, as the page sent them. */
    decisions: [] as { caseId: string; params: CaseDecidedParams }[],
    /** Every review the key confirmed: the reviewed decision and the params, as the page sent them. */
    reviews: [] as { decisionId: string; params: AppealsReviewedParams }[],
    /** Every image the page asked for, by its path, in order. */
    imageRequests: [] as string[],
    /**
     * The next image is refused though the page was right to ask for it: what the API answers when a report froze the
     * post between the page's read of the case and the browser's request for the image.
     */
    refuseNextImage: false,
    /**
     * The next read of a case is refused as a recusal: what the API answers when an account linked to the person came
     * to take part in the case since the page read it.
     */
    recuseNextCaseRead: false,
    /**
     * Every text the page saved, in order, with its salt and the digest it sent and the server recomputed; `used` once a
     * decision named it. A text saved when its field lost focus is here before any key is asked: the walk counts them.
     */
    texts: [] as { id: string; caseId: string; kind: string; text: string; salt: string; digest: string; createdAt: string; used?: boolean }[],
    /**
     * The next save of a text is refused with this code, as the API refuses a text that quotes what someone wrote about
     * the case (422) or a save over the minute's limit (429). Nothing is stored.
     */
    refuseNextSave: null as "text_quotes_user" | "rate_limited" | null,
    /**
     * A case and a kind of text: that case's answers carry its newest saved draft of the kind with other words under the
     * digest of what the person saved, as an API under an attacker's control would answer to put its own words into a
     * decision's draft. The page must drop it.
     */
    forgedDraft: null as { caseId: string; kind: string } | null,
    /**
     * The next save is answered with the digest of another text, one of this server's own choosing which it stores as
     * the person's: what an API under an attacker's control would answer to have the key confirm a reason nobody wrote.
     */
    hostileNextSave: false,
    /** The digests such answers carried. An action the page then builds from one of them is its fault. */
    forgedDigests: [] as string[],
    /** Every reveal the key confirmed: the item and the digest of its saved reason. */
    reveals: [] as { itemId: string; reasonDigest: string }[],
    /** Every finding the page opened. */
    findings: [] as FindingRequest[],
    snapshotsTaken: 0,
    stepUpOptionsServed: 0,
    requests: [] as RequestRecord[],
    problems: [] as string[],
  };
  // Two other live sessions of the person's, started earlier from other browsers and used minutes ago: one to revoke, one
  // for the mismatched step-up.
  for (const [i, browser] of OTHER_BROWSERS.entries()) {
    const handle = randomUUID();
    state.sessions.set(handle, { handle, token: b64url(32), csrf: b64url(32), browser, createdAt: now - (3 + i) * HOUR, lastUsedAt: now - (2 + 3 * i) * 60_000, credentialId: null });
  }

  const problem = (text: string) => state.problems.push(text);

  /** A ceremony's client data: its type, a challenge this server issued for `purpose` (spent here), and the page's origin. */
  function clientData(encoded: string, type: "webauthn.create" | "webauthn.get", purpose: "register" | "signin" | "step_up", refusal: StaffErrorCode) {
    let data: { type?: unknown; challenge?: unknown; origin?: unknown };
    try {
      data = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      problem(`${type}: client data that is not JSON`);
      throw refuse(refusal);
    }
    const issued = typeof data.challenge === "string" ? state.challenges.get(data.challenge) : undefined;
    if (data.type !== type || data.origin !== state.origin || issued?.purpose !== purpose) {
      problem(`${type}: client data for ${String(data.type)} at ${String(data.origin)}, challenge ${issued ? issued.purpose : "unknown"}`);
      throw refuse(refusal);
    }
    state.challenges.delete(data.challenge as string);
    return issued;
  }

  /** The session the staff cookie names, as requireStaff reads it: never cached, refused with both cookies cleared. */
  function requireStaff(req: IncomingMessage): SessionRecord {
    const jar = cookies(req);
    const session = [...state.sessions.values()].find((s) => s.token === jar.get(SESSION_COOKIE));
    const at = Date.now();
    if (!session || at >= session.createdAt + ABSOLUTE_MS || at >= session.lastUsedAt + IDLE_MS) throw refuse("staff_session_required", { "set-cookie": CLEAR_COOKIES });
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-staff-csrf"] !== jar.get(CSRF_COOKIE)) {
      problem(`${req.method} ${req.url}: the staff CSRF header does not echo the staff CSRF cookie`);
      throw new Refusal(403, "csrf_failed");
    }
    // Only a request its person's action started moves the idle end.
    if (req.headers["x-staff-activity"] === "1") session.lastUsedAt = at;
    return session;
  }

  function me(session: SessionRecord): StaffMe {
    const at = Date.now();
    const absoluteEnd = session.createdAt + ABSOLUTE_MS;
    const idleEnd = Math.min(session.lastUsedAt + IDLE_MS, absoluteEnd);
    return {
      handle: PERSON_HANDLE,
      role: state.role,
      sessionHandle: session.handle,
      idleExpiresAt: iso(idleEnd),
      idleSecondsLeft: Math.max(0, Math.floor((idleEnd - at) / 1000)),
      absoluteExpiresAt: iso(absoluteEnd),
      absoluteSecondsLeft: Math.max(0, Math.floor((absoluteEnd - at) / 1000)),
    };
  }

  function auditPage(query: URLSearchParams): AuditPage {
    const action = query.get("action");
    const cursor = query.get("cursor");
    const at = query.get("at");
    let rows = action === null ? state.audit : state.audit.filter((row) => row.action === action);
    if (cursor !== null) rows = rows.filter((row) => row.seq < Number(cursor));
    if (at !== null) rows = rows.filter((row) => row.seq <= Number(at));
    const entries = rows.slice(0, STAFF_AUDIT_PAGE_SIZE);
    return { entries, nextCursor: rows.length > entries.length ? entries[entries.length - 1]!.seq : null };
  }

  /** A step-up challenge in the contracts' layout; its seal is random, since only this server reads it back. */
  async function stepUpChallenge(sessionHandle: string, action: StaffStepUpActionInput): Promise<string> {
    const layout = STAFF_STEP_UP_CHALLENGE;
    const bytes = randomBytes(layout.bytes);
    bytes[layout.versionAt] = layout.version;
    bytes[layout.purposeAt] = layout.purpose;
    bytes.writeBigUInt64BE(BigInt(Date.now() + 10 * 60_000), layout.expiryAt);
    Buffer.from(await stepUpBinding(sessionHandle, await stepUpActionHash(action))).copy(bytes, layout.bindingAt);
    return bytes.toString("base64url");
  }

  /**
   * A case as its route answers it: with the person's saved texts of a decision's kinds that no decision has named yet,
   * oldest first, each with its salt, so that the page can hold it to its digest. The forged draft, where a step asked for
   * one, carries this server's words under the saved digest.
   */
  function caseAnswer(view: CaseView): CaseView {
    const drafts = state.texts
      .filter((text) => text.caseId === view.id && DRAFT_KINDS.includes(text.kind) && !text.used)
      .map((text): StaffTextDraft => ({ id: text.id, kind: text.kind as StaffTextDraft["kind"], text: text.text, salt: text.salt, digest: text.digest, createdAt: text.createdAt }));
    const forged = state.forgedDraft;
    const last = forged !== null && forged.caseId === view.id ? drafts.findLast((draft) => draft.kind === forged.kind) : undefined;
    return { ...view, drafts: drafts.map((draft) => (draft === last ? { ...draft, text: FORGED_DRAFT } : draft)) };
  }

  /**
   * The appeals of the fixtures' cases that no review has answered, newest first, as the list's route answers them: each
   * with its case, its decision and the marks the case's own answer carries, and never the appellant's statement.
   */
  function pendingAppeals(): AppealRow[] {
    const rows: AppealRow[] = [];
    for (const view of state.cases.values()) {
      for (const appeal of view.appeals) {
        const decided = view.decisions.find((found) => found.id === appeal.decisionId);
        if (appeal.result !== null || appeal.reviewer === null || !decided) continue;
        rows.push({
          id: appeal.id,
          caseId: view.id,
          decisionId: decided.id,
          filedAt: appeal.filedAt,
          decidedAt: decided.decidedAt,
          deadline: iso(Date.parse(decided.decidedAt) + 182 * 24 * HOUR),
          ruleId: decided.ruleId,
          legal: decided.ground === "illegal",
          actions: decided.actions.map((action) => action.kind),
          reviewer: appeal.reviewer,
          needsAdmin: appeal.needsAdmin,
          mayReview: appeal.mayReview,
        });
      }
    }
    return rows.sort((a, b) => (a.filedAt < b.filedAt ? 1 : -1));
  }

  function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      problem(`${what}: a body the contracts refuse`);
      throw new Refusal(400, "invalid_request");
    }
    return parsed.data;
  }

  /** One staff route's answer. */
  async function route(req: IncomingMessage, url: URL, body: unknown): Promise<Answer> {
    const key = `${req.method} ${url.pathname}`;

    if (key === "POST /api/staff/enroll/options") {
      const input = parse(StaffEnrollOptionsRequest, body, key);
      if (input.token !== state.enrolmentToken || state.enrolmentUsed) throw refuse("staff_enrollment_invalid");
      // Bound, as the API binds it, to the enrolment's id, which the page is never told: random bytes stand for its hash.
      const challenge = ceremonyChallenge("staff_register", randomBytes(CEREMONY_CHALLENGE.bindingBytes));
      state.challenges.set(challenge, { purpose: "register" });
      const securityKey = input.kind === "security_key";
      // As @simplewebauthn/server 14.0.2 writes them for the console: the security-key hint only with cross-platform attachment.
      const options = {
        challenge,
        rp: { id: "localhost", name: "korbat" },
        user: { id: userHandle, name: input.name, displayName: input.name },
        pubKeyCredParams: [-8, -7, -257].map((alg) => ({ alg, type: "public-key" })),
        timeout: 300_000,
        attestation: "none",
        excludeCredentials: state.keys.filter((k) => k.credentialId !== null).map((k) => ({ id: k.credentialId, type: "public-key" })),
        authenticatorSelection: { residentKey: "required", userVerification: "required", requireResidentKey: true, ...(securityKey ? { authenticatorAttachment: "cross-platform" } : {}) },
        extensions: { credProps: true },
        ...(securityKey ? { hints: ["security-key"] } : {}),
      };
      // As in production, the console's relying party ID is not the app's, so the page may signal a refused key.
      return { status: 200, body: { options, rpShared: false } };
    }

    if (key === "POST /api/staff/enroll/verify") {
      const input = parse(StaffEnrollVerifyRequest, body, key);
      if (input.token !== state.enrolmentToken || state.enrolmentUsed) throw refuse("staff_enrollment_invalid");
      clientData(input.response.response.clientDataJSON, "webauthn.create", "register", "staff_key_refused");
      const refusal = flagRefusal(flagsOf(authDataOf(Buffer.from(input.response.response.attestationObject, "base64url"))));
      // A refusal leaves the link usable, so the person can try another key.
      if (refusal) throw refuse(refusal);
      state.enrolmentUsed = true;
      const stored: KeyRecord = { id: randomUUID(), name: input.name, createdAt: iso(Date.now()), lastUsedAt: null, credentialId: input.response.id };
      state.keys.push(stored);
      return { status: 200, body: { key: { id: stored.id, name: stored.name, createdAt: stored.createdAt, lastUsedAt: stored.lastUsedAt } } };
    }

    if (key === "POST /api/staff/signin/options") {
      if (body !== undefined) problem(`${key}: a body, where the route takes none`);
      state.signInOptionsServed += 1;
      if (state.stepUpChallengeAtNextSignIn) {
        state.stepUpChallengeAtNextSignIn = false;
        // The forged case: a step-up challenge for revoking one of the person's sessions, bound to a handle of this
        // server's choosing. Never recorded as issued, so an assertion made over it would be a problem here too.
        const victim = [...state.sessions.values()][0]?.handle ?? randomUUID();
        const challenge = await stepUpChallenge(randomUUID(), { action: "staff_session_revoked", target: { type: "staff_session", id: victim }, params: {} });
        return { status: 200, body: { options: { challenge, rpId: "localhost", timeout: 300_000, userVerification: "required", allowCredentials: [] } } };
      }
      const challenge = ceremonyChallenge("staff_signin");
      state.challenges.set(challenge, { purpose: "signin" });
      return { status: 200, body: { options: { challenge, rpId: "localhost", timeout: 300_000, userVerification: "required", allowCredentials: [] } } };
    }

    if (key === "POST /api/staff/signin/verify") {
      const input = parse(StaffSignInVerifyRequest, body, key);
      clientData(input.response.response.clientDataJSON, "webauthn.get", "signin", "staff_key_invalid");
      const staffKey = state.keys.find((k) => k.credentialId !== null && k.credentialId === input.response.id);
      if (!staffKey || input.response.response.userHandle !== userHandle) throw refuse("staff_key_invalid");
      const refusal = flagRefusal(flagsOf(Buffer.from(input.response.response.authenticatorData, "base64url")));
      // Read after the signature, as the API reads them; staff_key_refused stands for flags it cannot read at all.
      if (refusal) throw refuse(refusal === "staff_key_refused" ? "staff_key_invalid" : refusal);
      staffKey.lastUsedAt = iso(Date.now());
      const session: SessionRecord = {
        handle: randomUUID(),
        token: b64url(32),
        csrf: b64url(32),
        browser: CURRENT_BROWSER,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        credentialId: staffKey.credentialId,
      };
      state.sessions.set(session.handle, session);
      const setCookies = [`${SESSION_COOKIE}=${session.token}; ${COOKIE}; HttpOnly; Max-Age=43200`, `${CSRF_COOKIE}=${session.csrf}; ${COOKIE}; Max-Age=43200`];
      return { status: 200, body: me(session), headers: { "set-cookie": setCookies } };
    }

    // Everything below needs a staff session.
    const routes = new Set([
      "GET /api/staff/me",
      "GET /api/staff/sessions",
      "GET /api/staff/keys",
      "GET /api/staff/audit",
      "POST /api/staff/signout",
      "POST /api/staff/step-up/options",
      "GET /api/staff/overview",
      "GET /api/staff/queue",
      "GET /api/staff/appeals",
      "POST /api/staff/findings",
    ]);
    const revoke = req.method === "DELETE" && /^\/api\/staff\/sessions\/[^/]+$/.test(url.pathname);
    const ofCase = /^\/api\/staff\/cases\/([0-9a-f-]{36})(?:\/(snapshots|texts|decisions))?$/.exec(url.pathname);
    const image = req.method === "GET" ? IMAGE_PATH.exec(url.pathname) : null;
    const reveal = req.method === "POST" ? /^\/api\/staff\/items\/([0-9a-f-]{36})\/reveal$/.exec(url.pathname) : null;
    const review = req.method === "POST" ? /^\/api\/staff\/decisions\/([0-9a-f-]{36})\/review$/.exec(url.pathname) : null;
    if (!routes.has(key) && !revoke && !ofCase && !image && !reveal && !review) throw new Refusal(404, "not_found");
    const session = requireStaff(req);

    // Moderation cases (3c design, section 7.3), answered from the fixtures' cases.
    if (key === "GET /api/staff/overview") {
      // The path's three lists: one decision of another staff account that answered a report without a seal, and what
      // the walk itself did, read from the cases as they now stand.
      const cases = [...state.cases.values()];
      const declined = cases.flatMap((view) => view.sealsDeclined.filter((text) => text.staffHandle === PERSON_HANDLE).map((text) => ({ at: text.createdAt, handle: text.staffHandle, caseId: view.id })));
      const seals = cases.flatMap((view) =>
        view.decisions
          .filter((decided) => decided.kind === "interim" && decided.staffHandle === PERSON_HANDLE)
          .flatMap((decided) => decided.actions.filter((action) => action.kind === "seal_media" && action.inForce).map((action) => ({ at: decided.decidedAt, handle: decided.staffHandle, caseId: view.id, posts: action.sealed?.posts ?? 0, images: action.sealed?.images ?? 0 }))),
      );
      // The appeals: those of the fixtures' cases that still wait, and one more that nobody at korbat can review now.
      const waiting = pendingAppeals().length + 1;
      return {
        status: 200,
        body: overview({
          appealsWaiting: waiting,
          appealsYouMayReview: pendingAppeals().filter((row) => row.mayReview).length,
          appealsWithoutReviewer: 1,
          reveals: { total: 1 + state.reveals.length, items: [{ at: iso(now - 26 * HOUR), handle: HOSTILE.script, caseId: CASE_POST }] },
          protectionLifted: { total: 1, items: [{ at: iso(now - 3 * HOUR), handle: HOSTILE.img, caseId: CASE_FROZEN, kind: "dismissed" }] },
          sealsDeclined: { total: declined.length, items: declined },
          interimSeals: { total: seals.length, items: seals },
          // Two due rules are late, so the home screen shows its line for late erasures with the runbook's sentence.
          erasureOverdue: { caseEvidence: 0, intakeRecords: 0, statements: 0, redactions: 0, images: 60, drafts: 0, accessLog: 0, contacts: 2 },
        }),
      };
    }
    if (key === "GET /api/staff/queue") {
      // Two pages: the two urgent cases, then the rest behind a cursor.
      const cursor = url.searchParams.get("cursor");
      if (cursor !== null && cursor !== "second-page") throw new Refusal(400, "invalid_request");
      const page: QueuePage = cursor === null ? { cases: QUEUE_ROWS.slice(0, 2), nextCursor: "second-page" } : { cases: QUEUE_ROWS.slice(2), nextCursor: null };
      return { status: 200, body: page };
    }
    if (key === "GET /api/staff/appeals") {
      // One page: what waits in the fixtures' cases, newest first, and an appeal of a seal that only an admin reviews and
      // that korbat's one admin took part in, so that the list shows each mark.
      if (url.searchParams.get("cursor") !== null) throw new Refusal(400, "invalid_request");
      const unreviewable: AppealRow = {
        id: "28a1b20d-7c39-4b0d-84a9-58f746db2a23",
        caseId: CASE_FROZEN,
        decisionId: "39b2c31e-8d4a-4c1e-95ba-69a857ec3b34",
        filedAt: iso(now - 30 * HOUR),
        decidedAt: iso(now - 9 * 24 * HOUR),
        deadline: iso(now + 170 * 24 * HOUR),
        ruleId: "R2",
        legal: false,
        actions: ["seal_media"],
        reviewer: "none_single_staff",
        needsAdmin: true,
        mayReview: false,
      };
      return { status: 200, body: { appeals: [unreviewable, ...pendingAppeals()], nextCursor: null } satisfies AppealsPage };
    }
    if (review) {
      const what = "POST /api/staff/decisions/:decision/review";
      const decisionId = review[1]!;
      const { stepUp, ...params } = parse(AppealReviewRequest, body, what);
      const found = [...state.cases.values()].find((view) => view.decisions.some((decided) => decided.id === decisionId));
      const reviewed = found?.decisions.find((decided) => decided.id === decisionId);
      if (!found || !reviewed) throw new Refusal(404, "not_found");
      // The assertion: by the session's own key, over a challenge issued for exactly this review of exactly this decision.
      const issued = clientData(stepUp.response.clientDataJSON, "webauthn.get", "step_up", "staff_step_up_invalid");
      const hash = await stepUpActionHash({ action: "appeals_reviewed", target: { type: "decision", id: decisionId }, params });
      if (issued.target !== decisionId || issued.hash !== hash || stepUp.id !== session.credentialId) {
        problem(`${what}: an assertion for ${String(issued.target)} from ${stepUp.id}, over ${issued.hash === hash ? "these" : "other"} params`);
        throw refuse("staff_step_up_invalid");
      }
      if (params.stateVersion !== found.stateVersion) throw new Refusal(MODERATION_REFUSAL_STATUS.case_changed, "case_changed");
      const appeal = found.appeals.find((filed) => filed.decisionId === decisionId && filed.result === null);
      // The appeal the key confirmed is the decision's pending one, and this person is one the case's answer let review it.
      if (!appeal || appeal.id !== params.appealId) throw new Refusal(MODERATION_REFUSAL_STATUS.case_changed, "case_changed");
      if (!appeal.mayReview) {
        problem(`${what}: a review by someone the case's answer did not mark as its reviewer`);
        throw new Refusal(MODERATION_REFUSAL_STATUS.reviewer_conflict, "reviewer_conflict");
      }
      const [newest] = found.snapshots;
      const shownDigest = !newest || newest.withheld ? null : await snapshotDigest({ ...newest });
      if (!newest || params.snapshotId !== newest.id || params.snapshotDigest !== shownDigest) {
        problem(`${what}: a snapshot that is not the case's newest as the page was shown it`);
        throw new Refusal(MODERATION_REFUSAL_STATUS.snapshot_mismatch, "snapshot_mismatch");
      }
      // The reason: one the page saved on this case as a review reason, not yet used, and never a digest this server made up.
      const saved = state.texts.find((text) => text.caseId === found.id && text.kind === "review_reason" && text.digest === params.reasonDigest && !text.used);
      if (!saved || state.forgedDigests.includes(params.reasonDigest)) {
        problem(`${what}: a review reason the page did not save on this case`);
        throw new Refusal(MODERATION_REFUSAL_STATUS.text_not_found, "text_not_found");
      }
      // A review lifts what is still in force of the reviewed decision, and its answer says how much.
      // 3e: the strike is not lifted one by one: it is overruled with the whole finding, and only then.
      const inForce = reviewed.actions.filter((action) => MEASURES[action.kind].lifts === null && action.kind !== "strike" && action.inForce).length;
      const lifted = params.actions.filter((action) => action.kind !== "overrule").length;
      if ((params.outcome === "kept" && lifted !== 0) || (params.outcome === "reversed" && lifted !== inForce) || (params.outcome === "partly_reversed" && (lifted === 0 || lifted >= inForce))) {
        problem(`${what}: an answer that its reversals do not bear out`);
        throw new Refusal(422, "invalid_decision");
      }
      const strikeIssue = strikeProblem(found, "review", params.outcome, null, null, params.actions, reviewed);
      if (strikeIssue !== null) {
        problem(`${what}: ${strikeIssue}`);
        throw new Refusal(422, "invalid_decision");
      }
      saved.used = true;
      state.reviews.push({ decisionId, params });
      applyReview(found, reviewed, params, saved.text, PERSON_HANDLE);
      return { status: 201, body: caseAnswer(found) };
    }
    if (key === "POST /api/staff/findings") {
      const finding = parse(FindingRequest, body, key);
      if (finding.target.kind === "link" && finding.target.url === DEAD_LINK) throw new Refusal(404, "not_found");
      state.findings.push(finding);
      return { status: 201, body: { caseId: CASE_POST } };
    }
    if (image) {
      const found = state.cases.get(image[1]!);
      state.imageRequests.push(url.pathname);
      if (state.refuseNextImage) {
        state.refuseNextImage = false;
        throw new Refusal(MODERATION_REFUSAL_STATUS.image_refused, "image_refused");
      }
      // As gate V and the image route answer: only an image of the case's own post, and none while it is frozen.
      const listed = found?.snapshots.some((snapshot) => !snapshot.withheld && snapshot.media?.some((media) => media.id === image[2]));
      if (!found || !found.imagesAllowed || !listed) {
        problem(`${key}: an image the console must not ask for`);
        throw new Refusal(MODERATION_REFUSAL_STATUS.image_refused, "image_refused");
      }
      return { status: 200, raw: { type: "image/webp", bytes: FIXTURE_WEBP }, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } };
    }
    if (ofCase) {
      const found = state.cases.get(ofCase[1]!);
      if (!found) throw new Refusal(404, "not_found");
      if (ofCase[2] === undefined && req.method === "GET") {
        if (state.recuseNextCaseRead) {
          state.recuseNextCaseRead = false;
          throw new Refusal(MODERATION_REFUSAL_STATUS.staff_recused, "staff_recused");
        }
        return { status: 200, body: caseAnswer(found) };
      }
      if (ofCase[2] === "snapshots" && req.method === "POST") {
        state.snapshotsTaken += 1;
        // The fresh snapshot holds the account's fields as they read now; the case then carries it first.
        const [newest] = found.snapshots;
        if (found.target.type === "account" && newest && !newest.withheld) {
          found.snapshots = [{ ...newest, id: randomUUID(), takenAt: iso(Date.now()), handle: found.target.handle, displayName: found.target.displayName, bio: found.target.bio }, ...found.snapshots];
        }
        return { status: 200, body: { id: found.snapshots[0]!.id, digest: found.snapshots[0]!.digest } };
      }
      if (ofCase[2] === "texts" && req.method === "GET") return { status: 200, body: { texts: [] } };
      if (ofCase[2] === "texts" && req.method === "POST") {
        const saved = parse(StaffTextSaveRequest, body, key);
        // No text is saved empty: the page's own buttons and its save never send one.
        if (saved.text.trim() === "") {
          problem(`${key}: an empty text`);
          throw new Refusal(400, "invalid_request");
        }
        // The server recomputes the digest: the console must have sent the digest of exactly the text it sent.
        if ((await textDigest(saved.salt, saved.text)) !== saved.digest) {
          problem(`${key}: a digest that is not the text's`);
          throw new Refusal(MODERATION_REFUSAL_STATUS.text_invalid, "text_invalid");
        }
        if (state.refuseNextSave !== null) {
          const code = state.refuseNextSave;
          state.refuseNextSave = null;
          throw new Refusal(MODERATION_REFUSAL_STATUS[code], code);
        }
        const id = randomUUID();
        const stored = { id, caseId: found.id, kind: saved.kind, salt: saved.salt, createdAt: iso(Date.now()) };
        if (state.hostileNextSave) {
          state.hostileNextSave = false;
          // The forged case: a text of this server's own is stored in the person's name, and its digest answered. A
          // reveal confirmed under that digest would go through here, so only the page's own check stops it.
          const digest = await textDigest(saved.salt, FORGED_REASON);
          state.texts.push({ ...stored, text: FORGED_REASON, digest });
          state.forgedDigests.push(digest);
          return { status: 201, body: { id, digest } };
        }
        state.texts.push({ ...stored, text: saved.text, digest: saved.digest });
        // A note and a recorded choice not to seal are complete when saved, and listed on the case.
        if (saved.kind === "note") found.notes = [...found.notes, { id, staffHandle: PERSON_HANDLE, createdAt: iso(Date.now()), text: saved.text }];
        if (saved.kind === "seal_declined") found.sealsDeclined = [...found.sealsDeclined, { id, staffHandle: PERSON_HANDLE, createdAt: iso(Date.now()), text: saved.text }];
        return { status: 201, body: { id, digest: saved.digest } };
      }
      if (ofCase[2] === "decisions" && req.method === "POST") {
        const what = "POST /api/staff/cases/:case/decisions";
        const { stepUp, ...params } = parse(CaseDecisionRequest, body, what);
        // The assertion: by the session's own key, over a challenge issued for exactly this decision on exactly this case.
        const issued = clientData(stepUp.response.clientDataJSON, "webauthn.get", "step_up", "staff_step_up_invalid");
        const hash = await stepUpActionHash({ action: "case_decided", target: { type: "case", id: found.id }, params });
        if (issued.target !== found.id || issued.hash !== hash || stepUp.id !== session.credentialId) {
          problem(`${what}: an assertion for ${String(issued.target)} from ${stepUp.id}, over ${issued.hash === hash ? "these" : "other"} params`);
          throw refuse("staff_step_up_invalid");
        }
        const flags = flagRefusal(flagsOf(Buffer.from(stepUp.response.authenticatorData, "base64url")));
        if (flags) throw refuse(flags === "staff_key_refused" ? "staff_step_up_invalid" : flags);
        if (params.stateVersion !== found.stateVersion) throw new Refusal(MODERATION_REFUSAL_STATUS.case_changed, "case_changed");
        // The snapshot: the case's newest, under the digest of what the page was shown, recomputed here from its members.
        const [newest] = found.snapshots;
        const shownDigest = !newest || newest.withheld ? null : await snapshotDigest({ ...newest });
        if (!newest || params.snapshotId !== newest.id || params.snapshotDigest !== shownDigest) {
          problem(`${what}: a snapshot that is not the case's newest as the page was shown it`);
          throw new Refusal(MODERATION_REFUSAL_STATUS.snapshot_mismatch, "snapshot_mismatch");
        }
        // 3e: the strike and its overruling, as the database holds them to the case's answer and the corrected decision.
        const strikeIssue = strikeProblem(found, params.kind, params.outcome, params.ground, params.ruleId, params.actions, found.decisions.find((decided) => decided.id === params.reviewsDecisionId));
        if (strikeIssue !== null) {
          problem(`${what}: ${strikeIssue}`);
          throw params.kind === "correction" ? new Refusal(422, "invalid_decision") : new Refusal(MODERATION_REFUSAL_STATUS.strike_mismatch, "strike_mismatch");
        }
        // Each text the decision names: one the page saved on this case, of its kind, not yet used, and never a digest this server made up.
        const named = [
          ["facts", params.factsDigest],
          [params.kind === "correction" ? "review_reason" : "reason", params.reasonDigest],
          ["legal_reference", params.legalReferenceDigest],
        ] as const;
        const texts: (string | null)[] = [];
        for (const [kind, digest] of named) {
          const saved = digest === null ? undefined : state.texts.find((text) => text.caseId === found.id && text.kind === kind && text.digest === digest && !text.used);
          if (digest !== null && (!saved || state.forgedDigests.includes(digest))) {
            problem(`${what}: a ${kind} text the page did not save on this case`);
            throw new Refusal(MODERATION_REFUSAL_STATUS.text_not_found, "text_not_found");
          }
          if (saved) saved.used = true;
          texts.push(saved?.text ?? null);
        }
        state.decisions.push({ caseId: found.id, params });
        applyDecision(found, params, { facts: texts[0] ?? null, reason: texts[1] ?? null, legalReference: texts[2] ?? null }, PERSON_HANDLE);
        return { status: 201, body: caseAnswer(found) };
      }
      throw new Refusal(404, "not_found");
    }
    if (reveal) {
      const itemId = reveal[1]!;
      const input = parse(IdentityRevealRequest, body, "POST /api/staff/items/:item/reveal");
      const issued = clientData(input.stepUp.response.clientDataJSON, "webauthn.get", "step_up", "staff_step_up_invalid");
      if (issued.target !== itemId || input.stepUp.id !== session.credentialId) {
        problem(`reveal ${itemId}: an assertion for ${String(issued.target)} from ${input.stepUp.id}`);
        throw refuse("staff_step_up_invalid");
      }
      const owner = [...state.cases.values()].find((view) => view.items.some((item) => item.id === itemId));
      // The reason must be one the page saved on the item's case, and used once.
      const reason = state.texts.find((text) => text.kind === "reveal_reason" && text.digest === input.reasonDigest && text.caseId === owner?.id);
      if (!owner || !reason || state.reveals.some((done) => done.reasonDigest === input.reasonDigest)) throw new Refusal(MODERATION_REFUSAL_STATUS.text_not_found, "text_not_found");
      state.reveals.push({ itemId, reasonDigest: input.reasonDigest });
      return { status: 200, body: { handle: REVEALED_HANDLE, name: null } };
    }

    if (key === "GET /api/staff/me") return { status: 200, body: me(session) };
    if (key === "GET /api/staff/sessions") {
      const sessions: StaffSession[] = [...state.sessions.values()].map((s) => ({
        handle: s.handle,
        browser: s.browser,
        createdAt: iso(s.createdAt),
        lastUsedAt: iso(s.lastUsedAt),
        current: s === session,
      }));
      return { status: 200, body: { sessions } };
    }
    if (key === "GET /api/staff/keys") return { status: 200, body: { keys: state.keys.map((k): StaffKey => ({ id: k.id, name: k.name, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })) } };
    if (key === "GET /api/staff/audit") return { status: 200, body: auditPage(url.searchParams) };
    if (key === "POST /api/staff/signout") {
      state.sessions.delete(session.handle);
      return { status: 204, headers: { "set-cookie": CLEAR_COOKIES } };
    }
    if (key === "POST /api/staff/step-up/options") {
      const action = parse(StaffStepUpOptionsRequest, body, key);
      const known =
        action.action === "identity_revealed"
          ? [...state.cases.values()].some((view) => view.items.some((item) => item.id === action.target.id))
          : action.action === "case_decided"
            ? state.cases.has(action.target.id)
            : action.action === "appeals_reviewed"
              ? [...state.cases.values()].some((view) => view.decisions.some((decided) => decided.id === action.target.id))
              : state.sessions.has(action.target.id);
      if (!known) throw new Refusal(404, "not_found");
      // The page builds a reveal's or a decision's params from the digests it computed itself: one a save's answer carried never gets here.
      const decided = action.action === "case_decided" ? CaseDecidedParams.parse(action.params) : null;
      const underDigests = decided ? [decided.factsDigest, decided.reasonDigest, decided.legalReferenceDigest] : action.action === "identity_revealed" || action.action === "appeals_reviewed" ? [action.params.reasonDigest] : [];
      if (underDigests.some((digest) => typeof digest === "string" && state.forgedDigests.includes(digest))) problem(`${key}: an action under a digest the page did not compute`);
      state.stepUpOptionsServed += 1;
      // The mismatched case: an API that asks the key to confirm the revocation of this very session instead of the one
      // chosen; for a reveal, the reveal of another item than the one chosen; for a decision, the same decision on the
      // case's next version, which the page never saw.
      let bound: StaffStepUpActionInput = action;
      if (state.mismatchNextStepUp) {
        if (decided) bound = { action: "case_decided", target: action.target, params: { ...decided, stateVersion: decided.stateVersion + 1 } } as StaffStepUpActionInput;
        else bound = { ...action, target: { ...action.target, id: action.action === "identity_revealed" ? randomUUID() : session.handle } } as StaffStepUpActionInput;
      }
      state.mismatchNextStepUp = false;
      const challenge = await stepUpChallenge(session.handle, bound);
      state.challenges.set(challenge, { purpose: "step_up", target: bound.target.id, hash: await stepUpActionHash(bound) });
      const allow = session.credentialId === null ? [] : [{ id: session.credentialId, type: "public-key", transports: ["usb"] }];
      return { status: 200, body: { options: { challenge, rpId: "localhost", timeout: 300_000, userVerification: "required", allowCredentials: allow } } };
    }

    // DELETE /api/staff/sessions/:handle, confirmed by the session's own key for exactly this session.
    const handle = decodeURIComponent(url.pathname.slice("/api/staff/sessions/".length));
    const { stepUp } = parse(StaffSessionRevokeRequest, body, "DELETE /api/staff/sessions/:handle");
    const issued = clientData(stepUp.response.clientDataJSON, "webauthn.get", "step_up", "staff_step_up_invalid");
    if (issued.target !== handle || stepUp.id !== session.credentialId) {
      problem(`DELETE ${handle}: an assertion for ${String(issued.target)} from ${stepUp.id}`);
      throw refuse("staff_step_up_invalid");
    }
    const refusal = flagRefusal(flagsOf(Buffer.from(stepUp.response.authenticatorData, "base64url")));
    if (refusal) throw refuse(refusal === "staff_key_refused" ? "staff_step_up_invalid" : refusal);
    if (!state.sessions.delete(handle)) throw new Refusal(404, "not_found");
    state.revoked.push(handle);
    return { status: 204 };
  }

  /** The staff gate: the console's Host, an Origin on every write and never another, and same-origin fetch metadata. */
  function gate(req: IncomingMessage) {
    if (req.headers.host !== new URL(state.origin).host) {
      problem(`${req.method} ${req.url}: Host ${String(req.headers.host)}`);
      throw new Refusal(404, "not_found");
    }
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin") {
      problem(`${req.method} ${req.url}: Sec-Fetch-Site ${site}`);
      throw new Refusal(403, "csrf_failed");
    }
    const origin = req.headers.origin;
    if ((origin !== undefined || (req.method !== "GET" && req.method !== "HEAD")) && origin !== state.origin) {
      problem(`${req.method} ${req.url}: Origin ${String(origin)}`);
      throw new Refusal(403, "csrf_failed");
    }
  }

  /** Answers one request under /api/staff, as the API behind Caddy's console site would. */
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL, raw: Buffer): Promise<void> {
    let answer: Answer;
    try {
      if (state.off) throw new Refusal(404, "not_found");
      gate(req);
      let body: unknown;
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          problem(`${req.method} ${url.pathname}: a body that is not JSON`);
          throw new Refusal(400, "invalid_request");
        }
      }
      answer = await route(req, url, body);
    } catch (err) {
      if (!(err instanceof Refusal)) throw err;
      answer = { status: err.status, body: { error: { code: err.code, message: "the fixture's own words" } }, headers: err.headers };
    }
    state.requests.push({ method: req.method ?? "", path: `${url.pathname}${url.search}`, status: answer.status, activity: req.headers["x-staff-activity"] === "1" });
    const headers: Record<string, string | string[]> = { "cache-control": "no-store", ...answer.headers };
    if (answer.raw) {
      res.writeHead(answer.status, { ...headers, "content-type": answer.raw.type, "content-length": String(answer.raw.bytes.length) });
      res.end(answer.raw.bytes);
      return;
    }
    if (answer.body === undefined) {
      res.writeHead(answer.status, headers);
      res.end();
      return;
    }
    res.writeHead(answer.status, { ...headers, "content-type": "application/json" });
    res.end(JSON.stringify(answer.body));
  }

  return {
    state,
    handle,
    /** Every staff session ends behind the page's back, as a revocation from the command line ends them. */
    endEverySession() {
      state.sessions.clear();
    },
    /**
     * Another staff member decides the case behind the page: a withhold of the post taken while deciding, under rule R6,
     * on the case as it stands. The post is then withheld and the case's version moves on, so a decision the page built
     * on the version it read is answered case_changed.
     */
    decideBehindThePage(caseId: string): void {
      const found = state.cases.get(caseId);
      const [newest] = found?.snapshots ?? [];
      if (!found || !newest) throw new Error("the fixtures hold no such case, or it has no snapshot");
      const params = CaseDecidedParams.parse({
        kind: "interim",
        stateVersion: found.stateVersion,
        throughSeq: 0,
        reviewsDecisionId: null,
        snapshotId: newest.id,
        snapshotDigest: hex64(),
        outcome: "restricted",
        ground: "incompatible",
        ruleId: "R6",
        rulesVersion: 2,
        redressVersion: 1,
        category: RULE_DEFAULT_CATEGORY.R6,
        categoryKeyword: null,
        actions: [{ kind: "withhold", mediaId: null }],
        factsDigest: hex64(),
        reasonDigest: hex64(),
        legalReferenceDigest: null,
        // 3e: every decision's params carry the marks and the withdrawal; this one sets neither.
        unfounded: [],
        replaced: false,
      });
      applyDecision(found, params, { facts: "The post repeats one link in every reply.", reason: "That is spam, which rule R6 names.", legalReference: null }, OTHER_STAFF);
      if (found.target.type === "post") found.target = { ...found.target, state: "withheld", level: "withheld" };
    },
    /** A new enrolment link, as `staff.js enroll` prints one for the person's next key; its token. */
    issueEnrolment(): string {
      state.enrolmentToken = b64url(32);
      state.enrolmentUsed = false;
      return state.enrolmentToken;
    },
  };
}
