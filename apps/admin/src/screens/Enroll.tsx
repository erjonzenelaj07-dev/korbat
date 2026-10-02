import { OpaqueId, StaffKeyName, type StaffKeyKind } from "@korbat/contracts";
import { useState } from "react";
import type { StaffApi } from "../api";
import { enrollKey, type EnrollResult, type SignalApi } from "../enroll";
import { describeError, messageFor } from "../messages";
import { signInWithKey } from "../sign-in";
import { UserText } from "../ui";
import type { CredentialsLike } from "../webauthn";

/**
 * The enrolment page (3a design, section 9), opened from the one-time link `staff.js enroll` printed. Before the ceremony
 * it says which keys work and which are refused, how to set a PIN, and that the key will show its name; it offers two
 * buttons, because the security-key hint hides Windows Hello. Each refusal is explained in words, and the page says the
 * link still works.
 */

/** What each refusal of a key means, in the person's terms, beside the console's message for its code. */
const EXPLANATIONS: Record<string, string> = {
  staff_key_not_device_bound: "The browser saved a synced passkey, from a password manager, instead of using a security key or Windows Hello.",
  staff_key_not_user_verified: "The key asked for no PIN or fingerprint.",
  staff_key_refused: "The browser's answer could not be checked.",
};

/** Refusals after which the link enrols nothing more: it is spent or expired, or the account has its five keys. */
const DEAD = new Set(["staff_enrollment_invalid", "staff_key_limit"]);

const NAME_RULE = "Give the key a name of 1 to 50 characters, without invisible characters.";

/**
 * The sign-in the success page runs with the key just registered (3a design, section 2: "after each enrolment the person
 * signs in once with the new key, which fails when the key stored is not theirs"): not yet asked, under way, the key
 * opened the console, or it did not, with the console's words for why.
 */
export type KeyCheck = { state: "none" } | { state: "busy" } | { state: "opened" } | { state: "failed"; message: string };

export interface EnrollViewProps {
  /** Whether the link's token has the shape of one: a malformed link asks nothing of the API. */
  tokenValid: boolean;
  name: string;
  nameError: string | null;
  /** The button whose ceremony is under way. */
  busy: StaffKeyKind | null;
  result: EnrollResult | null;
  check: KeyCheck;
  onName(name: string): void;
  onRegister(kind: StaffKeyKind): void;
  onCheck(): void;
}

function Refusal({ result }: { result: Extract<EnrollResult, { ok: false }> }) {
  const explanation = EXPLANATIONS[result.code];
  return (
    <div role="alert" className="error">
      <p>{messageFor(result.code)}</p>
      {explanation ? <p>{explanation}</p> : null}
      <p>This link still works: you can try again, with this key once it is fixed or with another one, until the link expires.</p>
      {result.cleanup === "signalled" ? <p>The browser was asked to remove the refused passkey from your password manager.</p> : null}
      {result.cleanup === "by-hand" ? <p>Delete the refused entry for the staff console from your password manager by hand, so it is not offered again.</p> : null}
    </div>
  );
}

export function EnrollView({ tokenValid, name, nameError, busy, result, check, onName, onRegister, onCheck }: EnrollViewProps) {
  const heading = <h2 id="enroll-title">Register a staff key</h2>;

  if (!tokenValid || (result && !result.ok && DEAD.has(result.code))) {
    return (
      <section className="panel" aria-labelledby="enroll-title">
        {heading}
        <p role="alert" className="error">
          {messageFor(tokenValid && result && !result.ok ? result.code : "staff_enrollment_invalid")}
        </p>
      </section>
    );
  }

  if (result?.ok) {
    // The check runs here, with this key alone, rather than on the sign-in page: that page shows home to a browser that
    // already holds a staff session (the usual case for a second key) and asks no key at all.
    if (check.state === "opened") {
      return (
        <section className="panel" aria-labelledby="enroll-title">
          {heading}
          <p role="status">
            The staff key <UserText>{result.key.name}</UserText> opened the console: you are signed in with it.
          </p>
          <p>
            <a href="/">Go to the home page</a>
          </p>
        </section>
      );
    }
    return (
      <section className="panel" aria-labelledby="enroll-title">
        {heading}
        <p role="status">
          The staff key <UserText>{result.key.name}</UserText> is registered.
        </p>
        <p>Sign in with it once now, so you know that it opens the console. If it does not, tell the operator at once.</p>
        <button type="button" className="primary" onClick={onCheck} disabled={check.state === "busy"} aria-busy={check.state === "busy"}>
          Sign in with this key
        </button>
        {check.state === "failed" ? (
          <div role="alert" className="error">
            <p>{check.message}</p>
            <p>If this key does not open the console, tell the operator at once: the key stored for you may not be this one.</p>
          </div>
        ) : null}
      </section>
    );
  }

  const describedBy = nameError ? "key-name-hint key-name-error" : "key-name-hint";
  return (
    <section className="panel" aria-labelledby="enroll-title">
      {heading}
      <p>This link registers one staff key for your staff account. Staff keys are the only way into the staff console.</p>

      <h3>Keys that work</h3>
      <ul>
        <li>A security key with a PIN: a FIDO2 key that you plug in or hold against the device.</li>
        <li>Windows Hello on this computer.</li>
      </ul>

      <h3>Keys that are refused</h3>
      <p>
        Passkeys saved by a password manager, such as iCloud Keychain or Google Password Manager, and a phone's own passkeys. They are synced or can be
        copied, so they cannot be staff keys. A phone's browser can still use a security key.
      </p>

      <h3>A new security key</h3>
      <p>
        A security key needs a PIN. If the browser does not offer to set one, set a PIN first: in Chrome or Edge under Settings, Privacy and security,
        Security, Manage security keys; on Windows under Settings, Accounts, Sign-in options, Security key; or with the app of the key's maker.
      </p>

      <label htmlFor="key-name">Name of this key</label>
      <p id="key-name-hint" className="hint">
        The key and the console will show this name, so use one that tells your keys apart, such as Blue key: not your email address or your real name.
      </p>
      <input
        id="key-name"
        type="text"
        value={name}
        maxLength={50}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={nameError !== null}
        aria-describedby={describedBy}
        onChange={(event) => onName(event.target.value)}
      />
      {nameError ? (
        <p id="key-name-error" className="error">
          {nameError}
        </p>
      ) : null}

      <div className="actions">
        <button type="button" className="primary" onClick={() => onRegister("security_key")} disabled={busy !== null} aria-busy={busy === "security_key"}>
          Register a security key
        </button>
        <button type="button" onClick={() => onRegister("this_device")} disabled={busy !== null} aria-busy={busy === "this_device"}>
          Use Windows Hello on this computer
        </button>
      </div>
      <p className="hint">For Windows Hello, choose Windows Hello or this device in the browser's dialog, not a password manager.</p>

      {result && !result.ok ? <Refusal result={result} /> : null}
    </section>
  );
}

export function Enroll({
  token,
  api,
  credentials,
  signal,
  onUnavailable,
}: {
  token: string;
  api: StaffApi;
  credentials: CredentialsLike;
  signal: SignalApi | undefined;
  onUnavailable(): void;
}) {
  const tokenValid = OpaqueId.safeParse(token).success;
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState<StaffKeyKind | null>(null);
  const [result, setResult] = useState<EnrollResult | null>(null);
  const [check, setCheck] = useState<KeyCheck>({ state: "none" });

  const register = async (kind: StaffKeyKind) => {
    // The name is checked by the contracts' own rule before anything is asked of the API or the browser.
    const parsed = StaffKeyName.safeParse(name);
    if (!parsed.success) {
      setNameError(NAME_RULE);
      return;
    }
    setNameError(null);
    setResult(null);
    setBusy(kind);
    const outcome = await enrollKey({ api, credentials, signal }, { token, name: parsed.data, kind });
    setBusy(null);
    // The staff routes are not there: the console is off, or this is not its address.
    if (!outcome.ok && outcome.status === 404) return onUnavailable();
    setResult(outcome);
  };

  /**
   * Signs in with the key just registered and with no other: the prompt's allow list is narrowed to its credential, and the
   * sign-in runs whatever staff session the browser already holds, which the new session's cookies replace.
   */
  const checkKey = async () => {
    if (!result?.ok) return;
    setCheck({ state: "busy" });
    try {
      await signInWithKey({ api, credentials }, result.credentialId);
      setCheck({ state: "opened" });
    } catch (err) {
      setCheck({ state: "failed", message: describeError(err) });
    }
  };

  return (
    <EnrollView
      tokenValid={tokenValid}
      name={name}
      nameError={nameError}
      busy={busy}
      result={result}
      check={check}
      onName={setName}
      onRegister={(kind) => void register(kind)}
      onCheck={() => void checkKey()}
    />
  );
}
