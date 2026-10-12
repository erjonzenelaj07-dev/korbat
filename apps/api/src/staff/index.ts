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
import type { AuditPageQuery } from "@korbat/contracts";
import type { Db } from "@korbat/db";
import type { AuthForStaff } from "../auth";
import type { ModerationForStaff } from "../moderation";
import { auditPage } from "./audit";
import { staffRoutes } from "./routes";

export { CHAIN_ZERO_HASH, canonicalText, chainHash, type ChainRow } from "./chain";
export { appendAuditRow, type AuditPlace, type StaffAuditRow } from "./audit";

export interface CreateStaffOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The auth module's staff interface: the credential side of the routes, which only the auth module may touch. */
  auth: AuthForStaff;
  /** The moderation module's staff interface: the console's operations on cases. */
  moderation: ModerationForStaff;
}

export function createStaff(options: CreateStaffOptions) {
  return {
    /** The routes under /api/staff, behind the staff gate for the console at `consoleOrigin`. */
    routes: (consoleOrigin: string) => staffRoutes(consoleOrigin, options.auth, options.moderation, (query) => auditPage(options.apiDb, query)),
    /** One page of the audit log, newest first, as GET /api/staff/audit answers it. */
    readAudit: (query: AuditPageQuery) => auditPage(options.apiDb, query),
  };
}

export type Staff = ReturnType<typeof createStaff>;
