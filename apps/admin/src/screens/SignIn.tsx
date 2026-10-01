import type { StaffMe } from "@korbat/contracts";
import { useState } from "react";
import { ApiError, type StaffApi } from "../api";
import { describeError } from "../messages";
import { authenticationResponseToJSON, ceremonyFailure, requestOptionsFromJSON, type CredentialsLike } from "../webauthn";

/**
 * Sign-in (3a design, section 9): "Sign in with your staff key", the browser's prompt, and errors in the console's words.
 * The options name no key (a staff key is discoverable), so a failure says to choose the security key or Windows Hello
 * rather than a password manager's passkey. Sign-in never calls the Signal API: every failure before the signature gets
 * one answer, so the page cannot know which credential was refused.
 */
export function SignInView({ ended, busy, error, onSignIn }: { ended: boolean; busy: boolean; error: string | null; onSignIn(): void }) {
  return (
    <section className="panel" aria-labelledby="signin-title">
      <h2 id="signin-title">Sign in</h2>
      {ended ? <p className="ended">Your staff session ended.</p> : null}
      <p>Use your staff key: your security key, or Windows Hello on the computer where you registered it. The browser asks for its PIN or your fingerprint.</p>
      <button type="button" className="primary" onClick={onSignIn} disabled={busy} aria-busy={busy}>
        Sign in with your staff key
      </button>
      {error ? (
        <div role="alert" className="error">
          <p>{error}</p>
          <p>In the browser's dialog, choose your security key or Windows Hello, not a passkey saved in a password manager: those cannot be staff keys.</p>
        </div>
      ) : null}
    </section>
  );
}

export function SignIn({
  ended,
  api,
  credentials,
  onSignedIn,
  onUnavailable,
}: {
  ended: boolean;
  api: StaffApi;
  credentials: CredentialsLike;
  onSignedIn(me: StaffMe): void;
  onUnavailable(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      // The person pressed the button: both requests are marked, though no session exists yet to move.
      const { options } = await api.signInOptions({ activity: true });
      let credential: unknown;
      try {
        credential = await credentials.get({ publicKey: requestOptionsFromJSON(options) });
      } catch (err) {
        throw ceremonyFailure(err);
      }
      const me = await api.signInVerify({ response: authenticationResponseToJSON(credential) }, { activity: true });
      setBusy(false);
      onSignedIn(me);
    } catch (err) {
      setBusy(false);
      // The staff routes are not there: the console is off, or this is not its address.
      if (err instanceof ApiError && err.status === 404) return onUnavailable();
      setError(describeError(err));
    }
  };

  return <SignInView ended={ended} busy={busy} error={error} onSignIn={() => void signIn()} />;
}
