/**
 * The only file outside `src/staff/` may import. Everything else in the module is private and the architecture test fails
 * the build if another file reaches into it.
 *
 * The staff module (3a design, section 5) runs on the API's role: it owns the audit log's reader, the chain's canonical
 * text in Node (chain.ts, which audit-verify recomputes the record with) and the writer for staff actions on public tables,
 * and it mounts the staff routes behind the staff gate. Staff keys, staff sessions and enrolments are credentials, the auth
 * module's alone: this module reaches them only through the auth module's interface. The cases are the moderation module's:
 * the console's case routes are mounted here, behind the same gate, and call that module's staff interface (3c design,
 * section 5).
 */
import type { AuditMarkRequest, AuditPageQuery } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { ActiveStaffSession, AuthForStaff, StaffStepUpConfirmed } from "../auth";
import type { ImportsForStaff } from "../imports";
import type { ModerationForStaff } from "../moderation";
import { auditPage, exportAudit, exportLines, markCopy } from "./audit";
import { staffRoutes, type StaffAudit } from "./routes";

export { CHAIN_ZERO_HASH, canonicalText, chainHash, type ChainRow } from "./chain";
export { appendAuditRow, exportLines, lastCopiedPlace, type AuditPlace, type StaffAuditRow } from "./audit";

export interface CreateStaffOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The auth module's staff interface: the credential side of the routes, which only the auth module may touch. */
  auth: AuthForStaff;
  /** The moderation module's staff interface: the console's operations on cases. */
  moderation: ModerationForStaff;
  /**
   * 3b Task 6: the imports module's staff interface, imports.forStaff: an admin's end of a whole import (8.7). Without it
   * the route is not mounted; the server always hands it over.
   */
  imports?: ImportsForStaff;
  now?: () => Date;
}

export function createStaff(options: CreateStaffOptions) {
  // The record's reader and, since 3f Task 6, the keeper's download and its mark, on the API's pool.
  const audit: StaffAudit = {
    page: (query, staffId) => auditPage(options.apiDb, query, staffId),
    export: (session: ActiveStaffSession, confirmed: StaffStepUpConfirmed, ctx: { requestId: string }) => exportAudit(options.apiDb, session, confirmed, ctx),
    lines: (after: number, through: number) => exportLines(options.apiDb, after, through),
    mark: (session: ActiveStaffSession, request: AuditMarkRequest, ctx: { requestId: string }) => markCopy(options.apiDb, session, request, ctx),
  };
  return {
    /** The routes under /api/staff, behind the staff gate for the console at `consoleOrigin`. */
    routes: (consoleOrigin: string) =>
      staffRoutes(consoleOrigin, options.auth, options.moderation, audit, options.imports ? { apiDb: options.apiDb, imports: options.imports, now: options.now ?? (() => new Date()) } : undefined),
    /** One page of the audit log, newest first, as GET /api/staff/audit answers it (with the reader's own copy, given its account). */
    readAudit: (query: AuditPageQuery, staffId: string | null = null) => auditPage(options.apiDb, query, staffId),
  };
}

export type Staff = ReturnType<typeof createStaff>;
