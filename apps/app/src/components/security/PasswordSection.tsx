import { useState } from "react";
import { View } from "react-native";
import { PasswordSetResponse, type MeResponse } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Notice } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export function PasswordSection({
  me,
  run,
  refresh,
}: {
  me: MeResponse;
  run: (action: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<unknown>;
}) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const length = [...password].length;
  const mismatch = repeat.length > 0 && repeat !== password;
  const ready = length >= 12 && length <= 128 && password === repeat;

  async function save() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run(async () => {
        await api("/api/auth/password/set", { json: { password }, schema: PasswordSetResponse });
        setPassword("");
        setRepeat("");
        setDone(me.user.hasPassword ? "Password changed." : "Password set. You can now sign in with it.");
        await refresh();
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Body>
        {me.user.hasPassword
          ? "You can sign in with your password or an emailed code."
          : "You sign in with emailed codes. A password is optional: 12 to 128 characters, checked against known breaches."}
      </Body>
      <Field label={me.user.hasPassword ? "New password" : "Password"} autoComplete="new-password" secureTextEntry value={password} onChangeText={setPassword} />
      <Field label="Repeat password" autoComplete="new-password" secureTextEntry value={repeat} onChangeText={setRepeat} onSubmitEditing={save} />
      <ErrorText message={mismatch ? "The passwords don't match." : error} />
      <Notice message={done} />
      <Button label={me.user.hasPassword ? "Change password" : "Set password"} onPress={() => void save()} busy={busy} disabled={!ready} />
    </View>
  );
}
