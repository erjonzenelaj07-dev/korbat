import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CEREMONY_CHALLENGE,
  CHALLENGE_PURPOSES,
  FindingRequest,
  IdentityRevealRequest,
  STAFF_AUDIT_PAGE_SIZE,
  STAFF_STEP_UP_CHALLENGE,
  StaffEnrollOptionsRequest,
  StaffEnrollVerifyRequest,
  StaffSessionRevokeRequest,
  StaffSignInVerifyRequest,
  StaffStepUpOptionsRequest,
  StaffTextSaveRequest,
  stepUpActionHash,
  stepUpBinding,
  textDigest,
  type AuditEntry,
  type AuditPage,
  type CaseView,
  type QueuePage,
  type StaffKey,
  type StaffMe,
  type StaffErrorCode,
  type StaffSession,
  type StaffStepUpActionInput,
} from "@korbat/contracts";
import type { z } from "zod";
import { accountCase, CASE_ACCOUNT, CASE_FROZEN, CASE_POST, CASE_QUOTED, frozenCase, LONGEST_EXPLANATION, LONGEST_NOTE, LOOKALIKE, overview, postCase, QUEUE_ROWS } from "../case-fixtures";
import { HOSTILE } from "../fixtures";

/**
 * The staff API as the browser check answers it (3a design, section 12): no database and no API process, only answers
 * from fixtures held in memory, shaped by the contracts, whose user-written strings are hostile. It checks what a real
 * browser sends, as far as the console's part goes: the staff gate's Host, Origin and fetch metadata, the staff CSRF
 * header on every write, the WebAuthn ceremonies' client data (type, challenge, origin) and the authenticator's flags
 * (user verified, never backup-eligible or backed up). Anything the page sent that the real API would refuse for the
 * page's own fault is listed in `problems`. Signatures are not verified: the API's own tests do that with its library.
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

/**
 * Every user-written string the console must show as text, exactly as written: 3a's handles, names and labels, and of the
 * cases a text made to look like the console's own line, the longest explanation and the longest note.
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
export const MODERATION_REFUSAL_STATUS = { text_not_found: 409, text_invalid: 422, image_refused: 404, staff_recused: 403 } as const;

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
    /** Challenges handed out and not yet spent, by their base64url text: what each was issued for. */
    challenges: new Map<string, { purpose: "register" | "signin" | "step_up"; target?: string }>(),
    /** The handles the page revoked with its key. */
    revoked: [] as string[],
    /** The cases the console can open: a post's, a frozen post's, an account's, and the one a quoting post links to. */
    cases: new Map<string, CaseView>([
      [CASE_POST, postCase()],
      [CASE_FROZEN, frozenCase()],
      [CASE_ACCOUNT, accountCase()],
      [CASE_QUOTED, postCase({ id: CASE_QUOTED, items: [], decisions: [], notes: [] })],
    ]),
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
    /** Every text the page saved, with the digest it sent and the server recomputed. */
    texts: [] as { caseId: string; kind: string; text: string; digest: string }[],
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
      role: "moderator",
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
      "POST /api/staff/findings",
    ]);
    const revoke = req.method === "DELETE" && /^\/api\/staff\/sessions\/[^/]+$/.test(url.pathname);
    const ofCase = /^\/api\/staff\/cases\/([0-9a-f-]{36})(?:\/(snapshots|texts))?$/.exec(url.pathname);
    const image = req.method === "GET" ? IMAGE_PATH.exec(url.pathname) : null;
    const reveal = req.method === "POST" ? /^\/api\/staff\/items\/([0-9a-f-]{36})\/reveal$/.exec(url.pathname) : null;
    if (!routes.has(key) && !revoke && !ofCase && !image && !reveal) throw new Refusal(404, "not_found");
    const session = requireStaff(req);

    // Moderation cases (3c design, section 7.3), answered from the fixtures' cases.
    if (key === "GET /api/staff/overview") return { status: 200, body: overview({ reveals: { total: 1 + state.reveals.length, items: [{ at: iso(now - 26 * HOUR), handle: HOSTILE.script, caseId: CASE_POST }] } }) };
    if (key === "GET /api/staff/queue") {
      // Two pages: the two urgent cases, then the rest behind a cursor.
      const cursor = url.searchParams.get("cursor");
      if (cursor !== null && cursor !== "second-page") throw new Refusal(400, "invalid_request");
      const page: QueuePage = cursor === null ? { cases: QUEUE_ROWS.slice(0, 2), nextCursor: "second-page" } : { cases: QUEUE_ROWS.slice(2), nextCursor: null };
      return { status: 200, body: page };
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
        return { status: 200, body: found };
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
        const id = randomUUID();
        if (state.hostileNextSave) {
          state.hostileNextSave = false;
          // The forged case: a text of this server's own is stored in the person's name, and its digest answered. A
          // reveal confirmed under that digest would go through here, so only the page's own check stops it.
          const digest = await textDigest(saved.salt, FORGED_REASON);
          state.texts.push({ caseId: found.id, kind: saved.kind, text: FORGED_REASON, digest });
          state.forgedDigests.push(digest);
          return { status: 201, body: { id, digest } };
        }
        state.texts.push({ caseId: found.id, kind: saved.kind, text: saved.text, digest: saved.digest });
        if (saved.kind === "note") found.notes = [...found.notes, { id, staffHandle: PERSON_HANDLE, createdAt: iso(Date.now()), text: saved.text }];
        return { status: 201, body: { id, digest: saved.digest } };
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
      const known = action.action === "identity_revealed" ? [...state.cases.values()].some((view) => view.items.some((item) => item.id === action.target.id)) : state.sessions.has(action.target.id);
      if (!known) throw new Refusal(404, "not_found");
      // The page builds a reveal's params from the digest it computed itself: one a save's answer carried never gets here.
      const underDigest = action.action === "identity_revealed" ? action.params.reasonDigest : null;
      if (typeof underDigest === "string" && state.forgedDigests.includes(underDigest)) problem(`${key}: a reveal under a digest the page did not compute`);
      state.stepUpOptionsServed += 1;
      // The mismatched case: an API that asks the key to confirm the revocation of this very session instead of the one
      // chosen, or, for a reveal, the reveal of another item than the one chosen.
      const other = action.action === "identity_revealed" ? randomUUID() : session.handle;
      const bound = state.mismatchNextStepUp ? { ...action, target: { ...action.target, id: other } } : action;
      state.mismatchNextStepUp = false;
      const challenge = await stepUpChallenge(session.handle, bound);
      state.challenges.set(challenge, { purpose: "step_up", target: bound.target.id });
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
    /** A new enrolment link, as `staff.js enroll` prints one for the person's next key; its token. */
    issueEnrolment(): string {
      state.enrolmentToken = b64url(32);
      state.enrolmentUsed = false;
      return state.enrolmentToken;
    },
  };
}
