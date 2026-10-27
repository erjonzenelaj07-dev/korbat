import {
  AppealsPage,
  AuditPage,
  CaseView,
  ContactPage,
  ErrorEnvelope,
  FindingResponse,
  HeldUpload,
  OrderView,
  OrdersPage,
  QueuePage,
  RestoreView,
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
  UploadsPage,
  type AppealReviewRequest,
  type AuditExportedParams,
  type AuditMarkRequest,
  type AuthenticationResponseJSON,
  type CaseDecisionRequest,
  type ContactCloseRequest,
  type FindingRequest,
  type IdentityRevealRequest,
  type ImportEndRequest,
  type OrderCorrectRequest,
  type OrderEffectRequest,
  type OrderEventRecordRequest,
  type OrderItemsRequest,
  type OrderOpenRequest,
  type SealReleaseRequest,
  type StaffEnrollOptionsRequest,
  type StaffEnrollVerifyRequest,
  type StaffSessionRevokeRequest,
  type StaffSignInVerifyRequest,
  type StaffStepUpOptionsRequest,
  type StaffTextSaveRequest,
  type UploadHoldEndRequest,
  type UploadReleaseRequest,
} from "@korbat/contracts";
import type { z } from "zod";
import { messageFor } from "./messages";
import { isLowerUuid, type CaseId, type OrderId } from "./router";

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
    /** 3f: what a refusal carries beside its code: order_exists names the order that stands ({ orderId }). */
    readonly details?: unknown,
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

/**
 * The audit reader's query: newest, before a cursor, or the page whose newest row is at a place; and its one filter. 3f
 * Task 6: or the rows a step-up of one key confirmed (`key`, a lower-case uuid), in a period (`from`, `to`, instants).
 */
export interface AuditQuery {
  action?: "staff_sign_in";
  cursor?: number;
  at?: number;
  key?: string;
  from?: string;
  to?: string;
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

/** 3f: an order answered under another order's address is no answer, as for a case. */
function sameOrder(asked: string, view: OrderView): OrderView {
  if (view.id !== asked) throw new ApiError(0, "invalid_answer");
  return view;
}

/** 3d Task 7: a held upload answered under another refusal's address is no answer, as for a case. */
function sameUpload(asked: string, view: HeldUpload): HeldUpload {
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
  async function request<T>(method: "GET" | "POST" | "DELETE", path: string, schema: z.ZodType<T> | null, call: Call, body?: unknown): Promise<T>;
  // 3f Task 6: the audit log's download answers JSON lines, which the screen reads as text and checks itself.
  async function request(method: "POST", path: string, schema: "text", call: Call, body?: unknown): Promise<string>;
  async function request<T>(method: "GET" | "POST" | "DELETE", path: string, schema: z.ZodType<T> | null | "text", call: Call, body?: unknown): Promise<T | string> {
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
      throw new ApiError(response.status, code, undefined, envelope.success ? envelope.data.error.details : undefined);
    }

    let value: T | string;
    if (schema === null) {
      value = undefined as T;
    } else if (schema === "text") {
      // A body that breaks off on the way ends here as a shorter text, or as a network failure.
      try {
        value = await response.text();
      } catch {
        throw new ApiError(0, "network");
      }
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
    // 3f Task 6: a key's id is a checked lower-case uuid and a time an instant the screen checked; both are encoded.
    if (q.key !== undefined) params.set("key", q.key);
    if (q.from !== undefined) params.set("from", q.from);
    if (q.to !== undefined) params.set("to", q.to);
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
    decide: async (caseId: string, body: CaseDecisionRequest, call: Call = {}, gap: string | null = null) => {
      if (!isLowerUuid(caseId) || (gap !== null && !isLowerUuid(gap))) throw new ApiError(0, "invalid_request");
      // 3f Task 6: a decision that takes a lost one again names the restore gap it closes, as the query member `gap`.
      return sameCase(caseId, await request("POST", `/api/staff/cases/${caseId}/decisions${gap === null ? "" : `?gap=${gap}`}`, CaseView, call, body));
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
    review: async (caseId: string, decisionId: string, body: AppealReviewRequest, call: Call = {}, gap: string | null = null) => {
      if (!isLowerUuid(caseId) || !isLowerUuid(decisionId) || (gap !== null && !isLowerUuid(gap))) throw new ApiError(0, "invalid_request");
      return sameCase(caseId, await request("POST", `/api/staff/decisions/${decisionId}/review${gap === null ? "" : `?gap=${gap}`}`, CaseView, call, body));
    },
    /**
     * 3f: a page of the messages at the contact point, newest first, all or only those nobody has handled. The cursor is
     * one the API itself handed out, encoded.
     */
    contact: (cursor: string | null, open: boolean, call: Call = {}) => {
      const params = new URLSearchParams();
      if (cursor !== null) params.set("cursor", cursor);
      if (open) params.set("open", "1");
      const text = params.toString();
      return request("GET", `/api/staff/contact${text === "" ? "" : `?${text}`}`, ContactPage, call);
    },
    /** 3f: closes a message as what it was. Its id must be a lower-case uuid; the route answers 204. */
    closeContact: async (messageId: string, body: ContactCloseRequest, call: Call = {}) => {
      if (!isLowerUuid(messageId)) throw new ApiError(0, "invalid_request");
      return request<void>("POST", `/api/staff/contact/${messageId}/close`, null, call, body);
    },
    /** 3f: the orders not closed and those closed in the last 30 days. */
    orders: (call: Call = {}) => request("GET", "/api/staff/orders", OrdersPage, call),
    /** 3f: one order. An answer about another order than the one asked is no answer. */
    order: async (id: OrderId, call: Call = {}) => sameOrder(id, await request("GET", `/api/staff/orders/${id}`, OrderView, call)),
    /** 3f: opens an order, with or without a message, without a key. */
    openOrder: (body: OrderOpenRequest, call: Call = {}) => request("POST", "/api/staff/orders", OrderView, call, body),
    /** 3f: more links for an order, without a key. */
    addOrderItems: async (id: OrderId, body: OrderItemsRequest, call: Call = {}) => sameOrder(id, await request("POST", `/api/staff/orders/${id}/items`, OrderView, call, body)),
    /** 3f: a clock event, a closing, a reopening or an extension; the order's id must be the lower-case uuid the step-up confirmed. */
    recordOrderEvent: async (id: string, body: OrderEventRecordRequest, call: Call = {}) => {
      if (!isLowerUuid(id)) throw new ApiError(0, "invalid_request");
      return sameOrder(id, await request("POST", `/api/staff/orders/${id}/events`, OrderView, call, body));
    },
    /** 3f Task 3: "Disable for an order"; the order's id must be the lower-case uuid the step-up confirmed. */
    effectOrder: async (id: string, body: OrderEffectRequest, call: Call = {}) => {
      if (!isLowerUuid(id)) throw new ApiError(0, "invalid_request");
      return sameOrder(id, await request("POST", `/api/staff/orders/${id}/effect`, OrderView, call, body));
    },
    /** 3f: a correction of what the order shows, with the step-up only under the rule admin. */
    correctOrder: async (id: string, body: OrderCorrectRequest, call: Call = {}) => {
      if (!isLowerUuid(id)) throw new ApiError(0, "invalid_request");
      return sameOrder(id, await request("POST", `/api/staff/orders/${id}/correct`, OrderView, call, body));
    },
    /**
     * 3f Task 6 (7.16): the audit log's tail after `after` up to `through`, confirmed with the key, as the text of its JSON
     * lines; the screen checks the lines before anything is saved or marked. A refusal is an ApiError as for any call.
     */
    exportAudit: async (body: AuditExportedParams & { stepUp: AuthenticationResponseJSON }, call: Call = {}) => request("POST", "/api/staff/audit/export", "text", call, body),
    /** 3f Task 6: the keeper's confirmation that the whole file is held: its last line's place and hash; 204, or copy_mismatch. */
    markCopy: (body: AuditMarkRequest, call: Call = {}) => request<void>("POST", "/api/staff/audit/export/mark", null, call, body),
    /** 3f Task 6: what an import after a restore found lost. */
    restore: (call: Call = {}) => request("GET", "/api/staff/restore", RestoreView, call),
    /** 3f Task 6: an admin's "Not needed" on a gap; its id must be the lower-case uuid the step-up confirmed. */
    closeGap: async (gapId: string, body: { disposition: "not_needed"; stepUp: AuthenticationResponseJSON }, call: Call = {}) => {
      if (!isLowerUuid(gapId)) throw new ApiError(0, "invalid_request");
      return request("POST", `/api/staff/restore/gaps/${gapId}/close`, RestoreView, call, body);
    },
    /**
     * 3d Task 2: an admin's release of a seal for good, with the key's confirmation: the seal's ledger row must already be
     * the lower-case uuid the step-up confirmed, since it is the action's target. The answer is the seal's case as it now
     * stands, and it must be the case of the page that asked.
     */
    releaseSeal: async (caseId: string, actionId: string, body: SealReleaseRequest, call: Call = {}) => {
      if (!isLowerUuid(actionId)) throw new ApiError(0, "invalid_request");
      return sameCase(caseId, await request("POST", `/api/staff/seals/${actionId}/release`, CaseView, call, body));
    },
    /**
     * 3b (design, sections 8.7 and 10.7): an admin's end of a whole import, with the key's confirmation: the import must
     * already be the lower-case uuid the step-up confirmed, since it is the action's target. The answer is the case the end
     * was taken from as it now stands, and it must be the case the body names, the page that asked.
     */
    endImport: async (importId: string, body: ImportEndRequest, call: Call = {}) => {
      if (!isLowerUuid(importId) || !isLowerUuid(body.caseId)) throw new ApiError(0, "invalid_request");
      return sameCase(body.caseId, await request("POST", `/api/staff/imports/${importId}/end`, CaseView, call, body));
    },
    /** 3d Task 7 (8.6): a page of Held uploads. The cursor is one the API itself handed out, encoded. */
    uploads: (cursor: string | null, call: Call = {}) => request("GET", `/api/staff/uploads${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`, UploadsPage, call),
    /**
     * 3d Task 7 (8.6): an admin's end of a held upload's hold, with the key's confirmation: the refusal must already be the
     * lower-case uuid the step-up confirmed, since it is the action's target. The answer is that refusal as it now shows.
     */
    endHold: async (refusalId: string, body: UploadHoldEndRequest, call: Call = {}) => {
      if (!isLowerUuid(refusalId)) throw new ApiError(0, "invalid_request");
      return sameUpload(refusalId, await request("POST", `/api/staff/uploads/${refusalId}/end`, HeldUpload, call, body));
    },
    /** 3d Task 7 (8.6): the release of a held upload ended as report, built and checked as the end is. */
    releaseUpload: async (refusalId: string, body: UploadReleaseRequest, call: Call = {}) => {
      if (!isLowerUuid(refusalId)) throw new ApiError(0, "invalid_request");
      return sameUpload(refusalId, await request("POST", `/api/staff/uploads/${refusalId}/release`, HeldUpload, call, body));
    },
    /** The item must already be the lower-case uuid the step-up confirmed: it is the action's target. */
    reveal: async (itemId: string, body: IdentityRevealRequest, call: Call = {}) => {
      if (!isLowerUuid(itemId)) throw new ApiError(0, "invalid_request");
      return request("POST", `/api/staff/items/${itemId}/reveal`, RevealResponse, call, body);
    },
  };
}
