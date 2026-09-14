import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MeResponse } from "@korbat/contracts";
import { api, ApiError } from "./api";

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; me: MeResponse };

interface SessionValue {
  state: SessionState;
  /** Reloads /api/me, for example after sign-in, onboarding or sign-out. */
  refresh(): Promise<SessionState>;
}

const SessionContext = createContext<SessionValue | null>(null);

async function loadSession(): Promise<SessionState> {
  try {
    return { status: "signed-in", me: await api("/api/me", { schema: MeResponse }) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return { status: "signed-out" };
    throw err;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async () => {
    const next = await loadSession().catch((): SessionState => ({ status: "signed-out" }));
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ state, refresh }), [state, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
