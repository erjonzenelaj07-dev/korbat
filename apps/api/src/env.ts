import type { Logger } from "pino";
import type { ActiveStaffSession, Session, StaffStepUpConfirmed } from "./auth";

export type { Session };

export type AppEnv = {
  Variables: {
    requestId: string;
    log: Logger;
    session: Session | null;
    /** How the session was presented: the HttpOnly cookie (web) or a bearer token (native). */
    authVia: "cookie" | "bearer" | null;
    /** The staff session requireStaff read on a staff route (3a design, section 7); never set elsewhere. */
    staffSession: ActiveStaffSession | null;
    /** The action a step-up confirmed, which requireStaffStepUp leaves for the route that executes and records it; never set elsewhere. */
    staffStepUp: StaffStepUpConfirmed | null;
    /** The client address as TRUST_PROXY says to read it, and its keyed hash: the only form limits and audit rows hold. */
    clientIp: string;
    clientIpHash: string;
    /** The keyed hash of the client's network: its IPv4 address, or the first 64 bits of its IPv6 address. Limits that count per network use it. */
    clientNetHash: string;
  };
};
