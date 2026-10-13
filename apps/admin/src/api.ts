import {
  AppealsPage,
  AuditPage,
  CaseView,
  ErrorEnvelope,
  FindingResponse,
  QueuePage,
  RevealResponse,
  StaffEnrollOptionsResponse,
  StaffEnrollVerifyResponse,
  StaffKeysResponse,
  StaffMe,
  StaffOverview,
  StaffSessionsResponse,
  StaffSignInOptionsResponse,
  StaffSignInVerifyResponse,
  StaffSnapshotTaken,
  StaffStepUpOptionsResponse,
  StaffTextSaved,
  StaffTextsResponse,
  StandingLists,
  type AppealReviewRequest,
  type CaseDecisionRequest,
  type FindingRequest,
  type IdentityRevealRequest,
  type StaffEnrollOptionsRequest,
  type StaffEnrollVerifyRequest,
  type StaffSessionRevokeRequest,
  type StaffSignInVerifyRequest,
  type StaffStepUpOptionsRequest,
  type StaffTextSaveRequest,
} from "@korbat/contracts";
import type { z } from "zod";
import { messageFor } from "./messages";
import { isLowerUuid, type CaseId } from "./router";

/**
 * The console's calls to its API (3a design, sections 7 and 9). Every call goes to /api/staff/* on the console's own
 * origin, with the staff session's cookies. Each echoes the staff CSRF cookie in x-staff-csrf (the API requires it on
 * every write), sends X-Staff-Activity: 1 only when its caller says a person's action started it, and parses the answer
 * with the contracts' schema, so nothing the page shows is anything but what the contracts describe.
 */

/** The staff CSRF cookie, which the page can read and the API compares with the header; never the app's. */
export const STAFF_CSRF_COOKIE = "__Host-korbat_staff_csrf";
export const STAFF_CSRF_HEADER = "x-staff-csrf";
/** The mark of a request a person's action started: only such a request moves the session's idle end. */
export const STAFF_ACTIVITY_HEADER = "x-staff-activity";

/** A failed call: the API's code, or the console's own (network, invalid_answer), with the console's words for it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string = messageFor(code),
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** What the API client runs on: the page's fetch and cookies, or a test's. */
export interface StaffApiDeps {
  fetch(input: string, init: RequestInit): Promise<Response>;
  cookie(): string;
}

/**
 * What the store listens for. Any staff_session_required answer means the API has already cleared both staff cookies,
 * so the store shows sign-in in place; a marked request that succeeded restarts the idle timer.
 */
export interface ApiHooks {
  /**
   * `carriedStaffCookie`: the refused request carried the staff CSRF cookie. Only a sign-in sets it, for the session's
   * 12 hours, and only a sign-out or a staff_session_required answer clears it, so a request that carried it was made
   * for a session that has now ended, even when no page held that session (a reload or a new tab after an idle-out).
   */
  onSessionRequired(carriedStaffCookie: boolean): void;
  onActivity(): void;
  /**
   * Every /me answer, marked or not: the session the browser's cookie names now, which the store keeps, so a page whose
   * cookie another tab replaced (a sign-out and a sign-in there) holds the new session's handle and binds step-ups to it.
   */
  onMe(me: StaffMe): void;
}

/** A call's options: `activity` is true only when a person's action (a click, a form, opening a screen) started it. */
export interface Call {
  activity?: boolean;
}

/** The audit reader's query: newest, before a cursor, or the page whose newest row is at a place; and its one filter. */
export interface AuditQuery {
  action?: "staff_sign_in";
  cursor?: number;
  at?: number;
}

/** A cookie's value by its exact name, from a document.cookie string. */
export function readCookie(cookies: string, name: string): string | undefined {
  for (const part of cookies.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator > 0 && trimmed.slice(0, separator) === name) {
      try {
        return decodeURIComponent(trimmed.slice(separator + 1));
      } catch {
        return trimmed.slice(separator + 1);
      }
    }
  }
  return undefined;
}

/**
 * A case answered under another case's address is no answer (3c design, section 7.5: the action is built from what the
 * page shows): the page would show one case and act on another, so nothing is built from it.
 */
function sameCase(asked: string, view: CaseView): CaseView {
  if (view.id !== asked) throw new ApiError(0, "invalid_answer");
  return view;
}

export type StaffApi = ReturnType<typeof createStaffApi>;

export function createStaffApi(deps: StaffApiDeps) {
  const hooks: ApiHooks = { onSessionRequired: () => undefined, onActivity: () => undefined, onMe: () => undefined };

  /**
   * One request. `schema` parses a 2xx answer; null means the route answers 204 with no body. A non-2xx answer becomes an
   * ApiError with the envelope's code (or not_found and internal when there is none), worded by the console.
   */
  async function request<T>(method: "GET" | "POST" | "DELETE", path: string, schema: z.ZodType<T> | null, call: Call, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    const csrf = readCookie(deps.cookie(), STAFF_CSRF_COOKIE);
    if (csrf) headers[STAFF_CSRF_HEADER] = csrf;
    if (call.activity === true) headers[STAFF_ACTIVITY_HEADER] = "1";
    if (body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    try {
      // Same origin only, never cached, and never redirected: the staff API answers every request itself.
      response = await deps.fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new ApiError(0, "network");
    }

    if (!response.ok) {
      const envelope = ErrorEnvelope.safeParse(await response.json().catch(() => null));
      const code = envelope.success ? envelope.data.error.code : response.status === 404 ? "not_found" : "internal";
      // The API cleared both staff cookies with this answer; the store shows sign-in in place. The cookie is gone from
      // the page by now, so what the request carried, read before it was sent, is the only record that it was there.
      if (code === "staff_session_required") hooks.onSessionRequired(Boolean(csrf));
      throw new ApiError(response.status, code);
    }

    let value: T;
    if (schema === null) {
      value = undefined as T;
    } else {
      const parsed = schema.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success) throw new ApiError(response.status, "invalid_answer");
      value = parsed.data;
    }
    // Only a marked success restarts the idle timer. A refused request moved nothing; one that did move the idle end but
    // failed later, or whose answer the schemas refused, only makes the timer read /me early, and it follows the answer.
    if (call.activity === true) hooks.onActivity();
    return value;
  }

  const query = (q: AuditQuery): string => {
    // Fixed order, numbers only: nothing a person typed reaches the address unchecked.
    const params = new URLSearchParams();
    if (q.action !== undefined) params.set("action", q.action);
    if (q.cursor !== undefined) params.set("cursor", String(q.cursor));
    if (q.at !== undefined) params.set("at", String(q.at));
    const text = params.toString();
    return text === "" ? "" : `?${text}`;
  };

  return {
    hooks,
    me: async (call: Call = {}) => {
      const me = await request("GET", "/api/staff/me", StaffMe, call);
      hooks.onMe(me);
      return me;
    },
    sessions: (call: Call = {}) => request("GET", "/api/staff/sessions", StaffSessionsResponse, call),
    keys: (call: Call = {}) => request("GET", "/api/staff/keys", StaffKeysResponse, call),
    audit: (q: AuditQuery, call: Call = {}) => request("GET", `/api/staff/audit${query(q)}`, AuditPage, call),
    signOut: (call: Call = {}) => request<void>("POST", "/api/staff/signout", null, call),
    signInOptions: (call: Call = {}) => request("POST", "/api/staff/signin/options", StaffSignInOptionsResponse, call),
    signInVerify: (body: StaffSignInVerifyRequest, call: Call = {}) => request("POST", "/api/staff/signin/verify", StaffSignInVerifyResponse, call, body),
    enrollOptions: (body: StaffEnrollOptionsRequest, call: Call = {}) => request("POST", "/api/staff/enroll/options", StaffEnrollOptionsResponse, call, body),
    enrollVerify: (body: StaffEnrollVerifyRequest, call: Call = {}) => request("POST", "/api/staff/enroll/verify", StaffEnrollVerifyResponse, call, body),
    stepUpOptions: (body: StaffStepUpOptionsRequest, call: Call = {}) => request("POST", "/api/staff/step-up/options", StaffStepUpOptionsResponse, call, body),
    /** The handle must already be the lower-case uuid the step-up confirmed: it is the action's target. */
    revokeSession: (handle: string, body: StaffSessionRevokeRequest, call: Call = {}) =>
      request<void>("DELETE", `/api/staff/sessions/${encodeURIComponent(handle)}`, null, call, body),

    // Moderation cases (3c design, section 7.3). A case's address is built from a checked id; every other value goes in
    // a body or, for the queue's cursor, is one the API itself handed out, encoded.
    overview: (call: Call = {}) => request("GET", "/api/staff/overview", StaffOverview, call),
    /** A page of the queue. Its refreshes carry no mark: they are the page's own, never its person's. */
    queue: (cursor: string | null, call: Call = {}) => request("GET", `/api/staff/queue${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`, QueuePage, call),
    caseView: async (id: CaseId, call: Call = {}) => sameCase(id, await request("GET", `/api/staff/cases/${id}`, CaseView, call)),
    takeSnapshot: (id: CaseId, call: Call = {}) => request("POST", `/api/staff/cases/${id}/snapshots`, StaffSnapshotTaken, call, {}),
    saveText: (id: CaseId, body: StaffTextSaveRequest, call: Call = {}) => request("POST", `/api/staff/cases/${id}/texts`, StaffTextSaved, call, body),
    texts: (id: CaseId, call: Call = {}) => request("GET", `/api/staff/cases/${id}/texts`, StaffTextsResponse, call),
    openFinding: (body: FindingRequest, call: Call = {}) => request("POST", "/api/staff/findings", FindingResponse, call, body),
    /**
     * A decision on a case, with the key's confirmation: the case must already be the lower-case uuid the step-up
     * confirmed, since it is the action's target. The answer is the case as it now stands, and it is that case's.
     */
    decide: async (caseId: string, body: CaseDecisionRequest, call: Call = {}) => {
      if (!isLowerUuid(caseId)) throw new ApiError(0, "invalid_request");
      return sameCase(caseId, await request("POST", `/api/staff/cases/${caseId}/decisions`, CaseView, call, body));
    },
    /** 3e: the Standing screen's four lists. */
    standing: (call: Call = {}) => request("GET", "/api/staff/standing", StandingLists, call),
    /** A page of the pending appeals, newest first. The cursor is one the API itself handed out, encoded. */
    appeals: (cursor: string | null, call: Call = {}) => request("GET", `/api/staff/appeals${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`, AppealsPage, call),
    /**
     * The review of the appeal of a decision, with the key's confirmation: the decision must already be the lower-case
     * uuid the step-up confirmed, since it is the action's target. The answer is the decision's case as it now stands,
     * and it must be the case of the page that asked.
     */
    review: async (caseId: string, decisionId: string, body: AppealReviewRequest, call: Call = {}) => {
      if (!isLowerUuid(caseId) || !isLowerUuid(decisionId)) throw new ApiError(0, "invalid_request");
      return sameCase(caseId, await request("POST", `/api/staff/decisions/${decisionId}/review`, CaseView, call, body));
    },
    /** The item must already be the lower-case uuid the step-up confirmed: it is the action's target. */
    reveal: async (itemId: string, body: IdentityRevealRequest, call: Call = {}) => {
      if (!isLowerUuid(itemId)) throw new ApiError(0, "invalid_request");
      return request("POST", `/api/staff/items/${itemId}/reveal`, RevealResponse, call, body);
    },
  };
}
