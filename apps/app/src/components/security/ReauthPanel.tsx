import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { z } from "zod";
import { FlowResponse, PasskeyOptionsResponse, ReauthResponse, type MeResponse, type ReauthRequest } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, TextLink } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { confirmWithPasskey, passkeysSupported } from "@/lib/passkeys";
import { useSession } from "@/lib/session";

type Action = () => Promise<void>;

/** The factor kinds a session can have proven (1c design, section 7.1), as the API names them. */
export type FactorKind = "email" | "password" | "passkey" | "passkey_uv" | "totp" | "recovery";

/** What a reauth_required refusal says: the level the action needs, and the factors proven within the last five minutes. */
export interface ReauthNeeded {
  level: 1 | 2;
  have: FactorKind[];
}

const Needed = z.object({ level: z.union([z.literal(1), z.literal(2)]), have: z.array(z.enum(["email", "password", "passkey", "passkey_uv", "totp", "recovery"])) });

/** Reads a refusal's details; an answer without them, or in a shape this app does not know, counts as level 1 with nothing proved. */
export function reauthNeeded(err: ApiError): ReauthNeeded {
  const parsed = Needed.safeParse(err.details);
  return parsed.success ? parsed.data : { level: 1, have: [] };
}

/** What the panel keeps for the action it will run again: the action, and what its refusal said is needed. */
export interface Pending {
  action: Action;
  needed: ReauthNeeded;
}

/**
 * Runs a sensitive action. When the server answers `reauth_required`, the action is kept, with what the refusal said
 * is needed, so the re-authentication panel can run it again once the person has confirmed it's them.
 */
export function useReauth() {
  const [pending, setPending] = useState<Pending | null>(null);
  const run = useCallback(async (action: Action) => {
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.code === "reauth_required") {
        setPending({ action, needed: reauthNeeded(err) });
        return;
      }
      throw err;
    }
  }, []);
  const clear = useCallback(() => setPending(null), []);
  return { pending, run, clear };
}

export type Method = "password" | "passkey" | "totp" | "email" | "recovery";

const FIRST: readonly FactorKind[] = ["email", "password", "passkey"];
const SECOND: readonly FactorKind[] = ["totp", "recovery"];
/** The methods that prove a first factor and those that prove a second; a passkey is in both, since a device that verifies the person makes it count as two. */
const PROVES_FIRST: readonly Method[] = ["password", "passkey", "email"];
const PROVES_SECOND: readonly Method[] = ["passkey", "totp", "recovery"];

/**
 * Which methods the panel offers (1c design, section 9): every one the account has at level 1; at level 2, only what
 * closes the gap the factors in `have` leave (a second factor after a first, a first after a second), and every one
 * when nothing was proved in time or nothing the account has would close it.
 */
export function methodsForLevel(needed: ReauthNeeded, available: Method[]): { methods: Method[]; missing: "first" | "second" | null } {
  if (needed.level === 2) {
    const hasFirst = needed.have.some((kind) => FIRST.includes(kind));
    const hasSecond = needed.have.some((kind) => SECOND.includes(kind));
    const missing = hasFirst && !hasSecond ? "second" : hasSecond && !hasFirst ? "first" : null;
    const proves = missing === "second" ? PROVES_SECOND : missing === "first" ? PROVES_FIRST : null;
    const methods = proves ? available.filter((method) => proves.includes(method)) : available;
    if (missing && methods.length > 0) return { methods, missing };
  }
  return { methods: available, missing: null };
}

/**
 * What the panel starts from for a refusal: what the refusal said is needed, the first method that closes the gap, and
 * nothing typed, mailed or refused yet. The same at mount and whenever another action's refusal takes the panel over.
 */
export function panelStart(needed: ReauthNeeded, available: Method[]): { needed: ReauthNeeded; method: Method; value: string; flowId: string | null; error: string | null } {
  return { needed, method: methodsForLevel(needed, available).methods[0]!, value: "", flowId: null, error: null };
}

/**
 * Whether the panel owes the hint to set two-factor up again: once any answer of its life spent a recovery code, whatever
 * was answered before or after it. `before` is what the earlier answers left.
 */
export function recoveryCodeSpent(before: boolean, answer: { mustReenrollMfa?: boolean }): boolean {
  return before || answer.mustReenrollMfa === true;
}

/** The hint after a recovery code was used, in the words of the Security screen's two-factor section. */
export const REENROLL_HINT = "You used a recovery code. Set up two-factor again to get a fresh set of codes.";

/**
 * The hint on a screen that has no two-factor section of its own (Account, Profile): shown once the panel set the
 * parameter on the route, with a link to Security, where two-factor is set up. The screen stays as it is, with what the
 * action just put on it.
 */
export function ReenrollNotice({ me }: { me: MeResponse }) {
  const { reenroll } = useLocalSearchParams<{ reenroll?: string }>();
  if (reenroll !== "1" || !me.user.mfaEnabled) return null;
  return (
    <View className="mt-6 rounded-lg bg-amber-500/10 px-4 py-3">
      <Text className="text-sm text-amber-300">{REENROLL_HINT}</Text>
      <TextLink label="Open Security" href="/settings/security?reenroll=1" />
    </View>
  );
}

const LABELS: Record<Method, string> = { password: "Password", passkey: "Passkey", totp: "Authenticator code", email: "Email code", recovery: "Recovery code" };

export function ReauthPanel({ me, pending, onClose }: { me: MeResponse; pending: Pending; onClose: () => void }) {
  const { refresh } = useSession();
  // The methods the account has, in the order the chips show them; a passkey only where the browser can use one.
  const available: Method[] = [
    ...(me.user.hasPassword ? (["password"] as const) : []),
    ...(me.user.passkeys > 0 && passkeysSupported() ? (["passkey"] as const) : []),
    ...(me.user.mfaEnabled ? (["totp"] as const) : []),
    "email",
    ...(me.user.mfaEnabled ? (["recovery"] as const) : []),
  ];
  const start = panelStart(pending.needed, available);
  // What the last refusal said is needed; the action's own refusal after a first answer replaces it.
  const [needed, setNeeded] = useState(start.needed);
  const { methods, missing } = methodsForLevel(needed, available);
  const [method, setMethod] = useState<Method>(start.method);
  const [value, setValue] = useState(start.value);
  const [flowId, setFlowId] = useState(start.flowId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(start.error);
  // The screens render one panel for whatever refusal is pending, so another action refused while this one is open
  // hands the same panel a new refusal. It starts over from that one, here rather than in an effect, so that no frame
  // shows the old refusal's sentence and methods above an action that needs something else.
  const [asked, setAsked] = useState(pending);
  if (asked !== pending) {
    const next = panelStart(pending.needed, available);
    setAsked(pending);
    setNeeded(next.needed);
    setMethod(next.method);
    setValue(next.value);
    setFlowId(next.flowId);
    setError(next.error);
  }
  // Whether an answer of this panel's life spent a recovery code. A ref, since the answer's own result is gone when the
  // action is refused again (the code was the first of two answers) or fails, and the hint is due all the same.
  const recoveryUsed = useRef(false);
  const panel = useRef<View>(null);
  // The panel appears in reply to an action elsewhere on the page, and so does each refusal that takes it over; focus
  // moves to it so the keyboard and a screen reader find it.
  useEffect(() => {
    (panel.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [pending]);

  /**
   * Closes the panel, after the action went through and on Cancel alike. A recovery code works once, so after one
   * two-factor should be set up again for a fresh set: the hint is a parameter set on the route the screen is on, which
   * keeps the screen mounted, with what the action just showed (new recovery codes, a QR code, the field for a mailed
   * code). Replacing the route would build the screen anew and lose that.
   */
  function close() {
    onClose();
    if (recoveryUsed.current) router.setParams({ reenroll: "1" });
  }

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

  /**
   * Sends one answer, then runs the action. A web session got fresh cookies with the answer, and a native client would
   * keep the token it carries; the session is reloaded so the app follows what the answer changed. When the action is
   * refused again, the level rose past what one answer gave, and the panel asks for what is still missing.
   */
  async function answer(body: ReauthRequest) {
    setBusy(true);
    setError(null);
    try {
      const result = await api("/api/auth/reauth", { json: body, schema: ReauthResponse });
      recoveryUsed.current = recoveryCodeSpent(recoveryUsed.current, result);
      setValue("");
      await refresh();
      try {
        await pending.action();
      } catch (err) {
        if (err instanceof ApiError && err.code === "reauth_required") {
          const next = reauthNeeded(err);
          setNeeded(next);
          setMethod(methodsForLevel(next, available).methods[0]!);
          setFlowId(null);
          return;
        }
        throw err;
      }
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /** The passkey method: the account's usable passkeys in the options, the browser's prompt, and the response as the answer. */
  async function passkey() {
    setBusy(true);
    setError(null);
    try {
      const { options } = await api("/api/auth/reauth/passkey/options", { method: "POST", schema: PasskeyOptionsResponse });
      const response = await confirmWithPasskey(options);
      // The prompt was closed: nothing to say.
      if (response === null) return;
      await answer({ method: "passkey", response });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Enter in the field confirms as the button does, so the button's condition comes first.
  async function confirm() {
    const typed = value.trim();
    if (typed.length === 0) return;
    if (method === "password") return answer({ method: "password", password: value });
    if (method === "totp") return answer({ method: "totp", code: typed });
    if (method === "recovery") return answer({ method: "recovery", recoveryCode: typed.toLowerCase() });
    if (flowId) return answer({ method: "email", flowId, code: typed });
    return undefined;
  }

  const explanation =
    missing === "second"
      ? "You confirmed a first factor; add a second one: an authenticator code, a recovery code, or a passkey that checks your fingerprint, face or PIN. "
      : missing === "first"
        ? "You confirmed a second factor; add a first one: your password, an email code or a passkey. "
        : "";

  return (
    <View ref={panel} role="dialog" aria-labelledby="reauth-title" tabIndex={-1} className="mt-6 rounded-xl border border-amber-500/40 bg-zinc-900 p-5">
      <Text nativeID="reauth-title" accessibilityRole="header" aria-level={2} className="text-lg font-semibold text-zinc-50">
        Confirm it's you
      </Text>
      <Text className="mt-1 text-sm text-zinc-400">
        {needed.level === 2 ? "This change needs two factors because two-factor authentication is on. " : "This change needs a fresh confirmation. "}
        {explanation}
        It stays valid for 5 minutes.
      </Text>
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
            {LABELS[m]}
          </Text>
        ))}
      </View>
      {method === "passkey" ? (
        <>
          <Body>Confirm with a passkey of this account. The browser will ask for it.</Body>
          <Button label="Use a passkey" onPress={() => void passkey()} busy={busy} />
        </>
      ) : method === "email" && !flowId ? (
        <Button label="Email me a code" onPress={() => void sendEmailCode()} busy={busy} tone="secondary" />
      ) : (
        <>
          <Field
            label={LABELS[method]}
            secureTextEntry={method === "password"}
            autoComplete={method === "password" ? "current-password" : method === "recovery" ? "off" : "one-time-code"}
            autoCapitalize={method === "recovery" ? "none" : undefined}
            inputMode={method === "password" || method === "recovery" ? "text" : "numeric"}
            maxLength={method === "recovery" ? 14 : undefined}
            placeholder={method === "recovery" ? "abcd-efgh-ijkl" : undefined}
            value={value}
            onChangeText={setValue}
            onSubmitEditing={() => void confirm()}
          />
          <Button label="Confirm" onPress={() => void confirm()} busy={busy} disabled={value.trim().length === 0} />
        </>
      )}
      <ErrorText message={error} />
      <Button label="Cancel" onPress={close} tone="secondary" />
    </View>
  );
}
