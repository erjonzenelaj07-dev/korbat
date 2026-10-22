import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState, View } from "react-native";
import { MeResponse } from "@korbat/contracts";
import { ErrorState, isOffline } from "@/components/kit/ErrorState";
import { api, ApiError, errorMessage, setSuspendedHandler, setUnauthenticatedHandler } from "./api";

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

/** Why /me could not be read: its sentence, and whether no answer came at all (offline, or no connection to korbat). */
interface Failure {
  message: string;
  offline: boolean;
}

/**
 * Only a 401 means signed out. Any other failure to load the session (no network, a 5xx, a limit)
 * is shown as such with a retry, instead of sending someone with a valid cookie back through sign-in.
 * It is the kit's ErrorState (UI design, section 6.12): the sentence as an alert and "Try again", or, when the request
 * got no answer (ApiError status 0), "You're offline", which tries again by itself once the browser is back online.
 */
function SessionFailure({ failure, onRetry }: { failure: Failure; onRetry: () => void }) {
  return (
    <View className="flex-1 justify-center bg-surface">
      <ErrorState message={failure.message} offline={failure.offline} onRetry={onRetry} />
    </View>
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [failure, setFailure] = useState<Failure | null>(null);

  const refresh = useCallback(async () => {
    setFailure(null);
    try {
      const next = await loadSession();
      setState(next);
      return next;
    } catch (err) {
      setFailure({ message: errorMessage(err), offline: isOffline(err) });
      return { status: "loading" } as const;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthenticatedHandler(() => setState((current) => (current.status === "signed-in" ? { status: "signed-out" } : current)));
    return () => setUnauthenticatedHandler(null);
  }, []);

  // 3e (design, section 9.1): /me again when the app gains focus and after a refusal account_suspended, so the banner and
  // a refusal's sentence are true of the row. Quietly: a read that fails keeps what is shown, and never the failure screen.
  useEffect(() => {
    const quiet = () => {
      loadSession()
        .then(setState)
        .catch(() => undefined);
    };
    setSuspendedHandler(quiet);
    const focus = AppState.addEventListener("change", (next) => {
      if (next === "active") quiet();
    });
    return () => {
      setSuspendedHandler(null);
      focus.remove();
    };
  }, []);

  const value = useMemo(() => ({ state, refresh }), [state, refresh]);
  // Stable, since ErrorState waits for the browser to come back online through an effect that depends on it.
  const retry = useCallback(() => void refresh(), [refresh]);
  return <SessionContext.Provider value={value}>{failure ? <SessionFailure failure={failure} onRetry={retry} /> : children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
