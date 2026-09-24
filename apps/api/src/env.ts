import type { Logger } from "pino";
import type { Session } from "./auth";

export type { Session };

export type AppEnv = {
  Variables: {
    requestId: string;
    log: Logger;
    session: Session | null;
    /** How the session was presented: the HttpOnly cookie (web) or a bearer token (native). */
    authVia: "cookie" | "bearer" | null;
    /** The client address as TRUST_PROXY says to read it, and its keyed hash: the only form limits and audit rows hold. */
    clientIp: string;
    clientIpHash: string;
  };
};
