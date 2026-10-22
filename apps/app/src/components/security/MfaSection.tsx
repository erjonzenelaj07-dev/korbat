import { useState } from "react";
import { View } from "react-native";
import { RecoveryCodesResponse, TotpConfirmResponse, TotpSetupResponse, type MeResponse } from "@korbat/contracts";
import { Icon } from "@/components/kit/Icon";
import { Text } from "@/components/kit/Text";
import { QrCode } from "@/components/security/QrCode";
import { Body, Button, ErrorText, Field } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { SECURITY_WORDS } from "@/lib/settings-words";

type Stage = { kind: "idle" } | { kind: "setup"; otpauthUri: string; qrSvg: string } | { kind: "codes"; recoveryCodes: string[] } | { kind: "disable" };

const clipboard = (globalThis as unknown as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } }).navigator?.clipboard;

/**
 * A hint to act on, in the review tone with its icon, so it does not rely on its colour (UI design, section 4.8): after a
 * recovery code was used, two-factor should be set up again for a fresh set.
 */
function Hint({ message }: { message: string }) {
  return (
    <View className="mt-3 flex-row items-start gap-2 rounded-control border border-review-ink/40 bg-review-wash px-3 py-2.5">
      <View className="pt-[3px]">
        <Icon name="review" size={16} tone="review-on-wash" />
      </View>
      <Text tone="review-on-wash" className="shrink">
        {message}
      </Text>
    </View>
  );
}

/**
 * Two-factor authentication on the Security screen (1c design): turning it on with an authenticator app's QR code or key
 * and its first code, the recovery codes once, new codes, and turning it off. On the tokens since UI Task 8 (8.8): the QR
 * code on a white plate, which a camera needs whatever the theme, and the key and the codes in the mono face.
 */
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

  // No code of its own (1c design, section 2): the route needs a level-2 re-authentication, which the panel provides, and the authenticator code given there already spent the current step.
  const disable = () =>
    act(async () => {
      await api("/api/auth/mfa/totp/disable", { json: {} });
      setStage({ kind: "idle" });
      await refresh();
    });

  if (stage.kind === "setup") {
    const secret = new URL(stage.otpauthUri).searchParams.get("secret") ?? "";
    return (
      <View>
        <Body>{SECURITY_WORDS.mfaSetup}</Body>
        {/* A literal white plate, not a theme's surface: a camera reads the code's dark squares only on light ground. */}
        <View className="mt-4 items-center self-center rounded-media border border-line-low bg-white p-3">
          <QrCode svg={stage.qrSvg} size={200} />
        </View>
        <Text variant="meta" tone="medium" className="mt-3">
          {SECURITY_WORDS.mfaKey}
        </Text>
        <Text variant="mono" selectable className="mt-1 web:break-all">
          {secret.replace(/(.{4})/g, "$1 ").trim()}
        </Text>
        <Field label="Code from the app" mono autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChangeText={setCode} onSubmitEditing={confirmSetup} />
        <ErrorText message={error} />
        <Button label="Turn on two-factor" onPress={confirmSetup} busy={busy} disabled={!/^[0-9]{6}$/.test(code.trim())} />
        <Button label="Cancel" onPress={() => setStage({ kind: "idle" })} tone="secondary" />
      </View>
    );
  }

  if (stage.kind === "codes") {
    return (
      <View>
        <Body>{SECURITY_WORDS.mfaCodes}</Body>
        <View className="mt-4 flex-row flex-wrap gap-y-2 rounded-control border border-line-low bg-surface-2 p-4">
          {stage.recoveryCodes.map((c) => (
            <Text key={c} variant="mono" selectable className="w-1/2">
              {c}
            </Text>
          ))}
        </View>
        {clipboard ? (
          <Button
            label={copied ? "Copied" : "Copy codes"}
            tone="secondary"
            onPress={() => {
              clipboard
                .writeText(stage.recoveryCodes.join(String.fromCharCode(10)))
                .then(() => setCopied(true))
                .catch(() => setError("Copying is not allowed here. Select the codes and copy them by hand."));
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
        <Body>{SECURITY_WORDS.mfaDisable}</Body>
        <ErrorText message={error} />
        <Button label="Turn off two-factor" onPress={disable} busy={busy} tone="danger" />
        <Button label="Cancel" onPress={() => setStage({ kind: "idle" })} tone="secondary" />
      </View>
    );
  }

  return (
    <View>
      {reenroll && me.user.mfaEnabled ? <Hint message="You used a recovery code. Set up two-factor again to get a fresh set of codes." /> : null}
      <Body>
        {me.user.mfaEnabled
          ? "Two-factor authentication is on. Signing in needs a code from your authenticator app."
          : me.user.role === "user"
            ? "Two-factor authentication is off. Turn it on so a leaked password or email alone can't open your account."
            : "Two-factor authentication is off. Turn it on so a leaked password or email alone can't open your account; on a staff account it then stays on. Staff tools are on the staff console and open only with a staff key."}
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
