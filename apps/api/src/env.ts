import type { Logger } from "pino";

export interface Session {
  sessionId: string;
  userId: string;
}

export type AppEnv = {
  Variables: {
    requestId: string;
    log: Logger;
    session: Session | null;
  };
};
