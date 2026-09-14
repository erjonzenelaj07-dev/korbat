import { useState } from "react";
import { Text, View } from "react-native";
import { RecoveryCodesResponse, TotpConfirmResponse, TotpSetupResponse, type MeResponse } from "@korbat/contracts";
import { QrCode } from "@/components/security/QrCode";
import { Body, Button, ErrorText, Field } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type Stage = { kind: "idle" } | { kind: "setup"; otpauthUri: string; qrSvg: string } | { kind: "codes"; recoveryCodes: string[] } | { kind: "disable" };

const clipboard = (globalThis as unknown as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }).navigator?.clipboard;

export function MfaSection({
  me,
  run,
  refresh,
  reenroll,
}: {
  me: MeResponse;
  run: (action: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<unknown>;
  reenroll: boolean;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await run(action);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const startSetup = () =>
    act(async () => {
      const setup = await api("/api/auth/mfa/totp/setup", { method: "POST", schema: TotpSetupResponse });
      setCode("");
      setStage({ kind: "setup", ...setup });
    });

  const confirmSetup = () =>
    act(async () => {
      const { recoveryCodes } = await api("/api/auth/mfa/totp/confirm", { json: { code: code.trim() }, schema: TotpConfirmResponse });
      setCode("");
      setStage({ kind: "codes", recoveryCodes });
      await refresh();
    });

  const regenerate = () =>
    act(async () => {
      const { recoveryCodes } = await api("/api/auth/mfa/recovery-codes/regenerate", { method: "POST", schema: RecoveryCodesResponse });
      setStage({ kind: "codes", recoveryCodes });
    });

  const disable = () =>
    act(async () => {
      await api("/api/auth/mfa/totp/disable", { json: { code: code.trim() } });
      setCode("");
      setStage({ kind: "idle" });
      await refresh();
    });

  if (stage.kind === "setup") {
    const secret = new URL(stage.otpauthUri).searchParams.get("secret") ?? "";
    return (
      <View>
        <Body>Scan this QR code with an authenticator app, then enter the 6-digit code it shows.</Body>
        <View className="mt-4 items-center rounded-lg bg-white p-3">
          <QrCode svg={stage.qrSvg} size={200} />
        </View>
        <Text className="mt-3 text-xs text-zinc-400">Can't scan it? Enter this key: </Text>
        <Text selectable className="mt-1 font-mono text-sm text-zinc-200">
          {secret.replace(/(.{4})/g, "$1 ").trim()}
        </Text>
        <Field label="Code from the app" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={confirmSetup} />
        <ErrorText message={error} />
        <Button label="Turn on two-factor" onPress={confirmSetup} busy={busy} disabled={!/^\d{6}$/.test(code.trim())} />
        <Button label="Cancel" onPress={() => setStage({ kind: "idle" })} tone="secondary" />
      </View>
    );
  }

  if (stage.kind === "codes") {
    return (
      <View>
        <Body>Save these recovery codes somewhere safe. Each works once, and they are the only way back into your account if you lose your authenticator. They won't be shown again.</Body>
        <View className="mt-4 flex-row flex-wrap gap-2 rounded-lg bg-zinc-900 p-4">
          {stage.recoveryCodes.map((c) => (
            <Text key={c} selectable className="w-[46%] font-mono text-base text-zinc-100">
              {c}
            </Text>
          ))}
        </View>
        {clipboard ? (
          <Button
            label={copied ? "Copied" : "Copy codes"}
            tone="secondary"
            onPress={() => {
              void clipboard.writeText(stage.recoveryCodes.join("\n")).then(() => setCopied(true));
            }}
          />
        ) : null}
        <Button label="I saved my recovery codes" onPress={() => setStage({ kind: "idle" })} />
      </View>
    );
  }

  if (stage.kind === "disable") {
    return (
      <View>
        <Body>Enter a code from your authenticator app to turn two-factor off.</Body>
        <Field label="Authentication code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={disable} />
        <ErrorText message={error} />
        <Button label="Turn off two-factor" onPress={disable} busy={busy} disabled={!/^\d{6}$/.test(code.trim())} tone="danger" />
        <Button label="Cancel" onPress={() => setStage({ kind: "idle" })} tone="secondary" />
      </View>
    );
  }

  return (
    <View>
      {reenroll && me.user.mfaEnabled ? (
        <Text className="mt-3 rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          You signed in with a recovery code. Set up two-factor again to get a fresh set of codes.
        </Text>
      ) : null}
      <Body>
        {me.user.mfaEnabled
          ? "Two-factor authentication is on. Signing in needs a code from your authenticator app."
          : me.user.role === "user"
            ? "Two-factor authentication is off. Turn it on so a leaked password or email alone can't open your account."
            : "Staff accounts must turn on two-factor authentication before using staff tools."}
      </Body>
      <ErrorText message={error} />
      {me.user.mfaEnabled ? (
        <>
          <Button label="Set up a new authenticator" onPress={() => void startSetup()} busy={busy} tone={reenroll ? "primary" : "secondary"} />
          <Button label="New recovery codes" onPress={() => void regenerate()} busy={busy} tone="secondary" />
          {me.user.role === "user" ? <Button label="Turn off two-factor" onPress={() => setStage({ kind: "disable" })} tone="danger" /> : null}
        </>
      ) : (
        <Button label="Turn on two-factor" onPress={() => void startSetup()} busy={busy} />
      )}
    </View>
  );
}
