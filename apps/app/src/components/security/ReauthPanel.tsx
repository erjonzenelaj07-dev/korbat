import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { FlowResponse, type MeResponse } from "@korbat/contracts";
import { Button, ErrorText, Field } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";

type Action = () => Promise<void>;

/**
 * Runs a sensitive action. When the server answers `reauth_required`, the action is kept so the
 * re-authentication panel can run it again once the person has confirmed it's them.
 */
export function useReauth() {
  const [pending, setPending] = useState<Action | null>(null);
  const run = useCallback(async (action: Action) => {
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.code === "reauth_required") {
        setPending(() => action);
        return;
      }
      throw err;
    }
  }, []);
  const clear = useCallback(() => setPending(null), []);
  return { pending, run, clear };
}

type Method = "password" | "totp" | "email";

export function ReauthPanel({ me, pending, onClose }: { me: MeResponse; pending: Action; onClose: () => void }) {
  const methods: Method[] = [...(me.user.hasPassword ? ["password" as const] : []), ...(me.user.mfaEnabled ? ["totp" as const] : []), "email"];
  const [method, setMethod] = useState<Method>(methods[0]!);
  const [value, setValue] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<View>(null);
  // The panel appears in reply to an action elsewhere on the page; focus moves to it so the keyboard and a screen reader find it.
  useEffect(() => {
    (panel.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, []);

  async function sendEmailCode() {
    setBusy(true);
    setError(null);
    try {
      setFlowId((await api("/api/auth/reauth/email/start", { method: "POST", schema: FlowResponse })).flowId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const body = method === "password" ? { method, password: value } : method === "totp" ? { method, code: value.trim() } : { method, flowId, code: value.trim() };
      await api("/api/auth/reauth", { json: body });
      setValue("");
      await pending();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const labels: Record<Method, string> = { password: "Password", totp: "Authenticator code", email: "Email code" };

  return (
    <View ref={panel} role="dialog" aria-labelledby="reauth-title" tabIndex={-1} className="mt-6 rounded-xl border border-amber-500/40 bg-zinc-900 p-5">
      <Text nativeID="reauth-title" accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-50">
        Confirm it's you
      </Text>
      <Text className="mt-1 text-sm text-zinc-400">This change needs a fresh confirmation. It stays valid for 5 minutes.</Text>
      <View className="mt-4 flex-row flex-wrap gap-2">
        {methods.map((m) => (
          <Text
            key={m}
            accessibilityRole="button"
            aria-pressed={m === method}
            onPress={() => {
              setMethod(m);
              setValue("");
              setError(null);
            }}
            className={`rounded-full px-3 py-1 text-sm ${m === method ? "bg-zinc-50 text-zinc-950" : "border border-zinc-600 text-zinc-300"}`}
          >
            {labels[m]}
          </Text>
        ))}
      </View>
      {method === "email" && !flowId ? (
        <Button label="Email me a code" onPress={sendEmailCode} busy={busy} tone="secondary" />
      ) : (
        <>
          <Field
            label={labels[method]}
            secureTextEntry={method === "password"}
            autoComplete={method === "password" ? "current-password" : "one-time-code"}
            inputMode={method === "password" ? "text" : "numeric"}
            value={value}
            onChangeText={setValue}
            onSubmitEditing={confirm}
          />
          <Button label="Confirm" onPress={confirm} busy={busy} disabled={value.length === 0} />
        </>
      )}
      <ErrorText message={error} />
      <Button label="Cancel" onPress={onClose} tone="secondary" />
    </View>
  );
}
