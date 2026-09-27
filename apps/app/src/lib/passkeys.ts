import { Platform } from "react-native";
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  WebAuthnError,
  type StartAuthenticationOpts,
  type StartRegistrationOpts,
} from "@simplewebauthn/browser";
import { AuthenticationResponseJSON, RegistrationResponseJSON, type PasskeyOptionsResponse } from "@korbat/contracts";
import { ApiError } from "./api";

/**
 * Passkeys in the browser (1c design, section 9): thin wrappers over @simplewebauthn/browser, which encodes the binary
 * members of a WebAuthn response, runs the conditional request behind the email field's autofill, and keeps one
 * ceremony at a time through its abort service. Every ceremony here answers null on native and in a browser without
 * WebAuthn, and again when the person closed the browser's prompt, so a screen shows nothing for those. A response is
 * parsed into the contract's shape, which drops the members the library adds beside it and hands the screens the
 * wire type.
 */

/** The options of a ceremony as the API hands them out: only the challenge is typed, the browser library knows the rest. */
type Options = PasskeyOptionsResponse["options"];

/** Whether this is a browser with WebAuthn: the screens show their passkey controls only then. */
export function passkeysSupported(): boolean {
  return Platform.OS === "web" && browserSupportsWebAuthn();
}

/** Whether the browser can offer its passkeys in the email field's autofill (conditional mediation). */
export async function autofillSupported(): Promise<boolean> {
  return passkeysSupported() && (await browserSupportsWebAuthnAutofill());
}

/** Whether the device has a built-in authenticator (a screen lock, Windows Hello, Touch ID), which the home screen's suggestion needs. */
export async function platformPasskeyAvailable(): Promise<boolean> {
  return passkeysSupported() && (await platformAuthenticatorIsAvailable());
}

/** What the browser can say when a ceremony fails for a reason other than a cancellation; the rest is one sentence. */
function browserMessage(code: string): string {
  switch (code) {
    case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
      return "This device already holds a passkey for your account.";
    case "ERROR_INVALID_DOMAIN":
    case "ERROR_INVALID_RP_ID":
      return "Passkeys do not work at this address.";
    case "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT":
      return "This authenticator cannot store a passkey. Try another one.";
    default:
      return "The browser could not finish the passkey request. Try again.";
  }
}

/**
 * A prompt the person closed (NotAllowedError, which browsers also use for a prompt that timed out) and a ceremony
 * korbat aborted itself are quiet: null, and the screen shows nothing. Anything else the browser refused becomes an
 * ApiError, so errorMessage shows its sentence as it shows a server's.
 */
function quietOrRefused(err: unknown): null {
  const name = err instanceof Error ? err.name : "";
  const code = err instanceof WebAuthnError ? err.code : "";
  if (name === "NotAllowedError" || name === "AbortError" || code === "ERROR_CEREMONY_ABORTED") return null;
  throw new ApiError(0, "passkey_browser", browserMessage(code));
}

/** Creates a passkey from the API's registration options. */
export async function createPasskey(options: Options): Promise<RegistrationResponseJSON | null> {
  if (!passkeysSupported()) return null;
  try {
    return RegistrationResponseJSON.parse(await startRegistration({ optionsJSON: options as unknown as StartRegistrationOpts["optionsJSON"] }));
  } catch (err) {
    return quietOrRefused(err);
  }
}

/** Signs or re-authenticates with a passkey through the browser's own prompt, from the API's options. */
export async function confirmWithPasskey(options: Options): Promise<AuthenticationResponseJSON | null> {
  if (!passkeysSupported()) return null;
  try {
    return AuthenticationResponseJSON.parse(await startAuthentication({ optionsJSON: options as unknown as StartAuthenticationOpts["optionsJSON"] }));
  } catch (err) {
    return quietOrRefused(err);
  }
}

/** The conditional request behind the email field: the browser lists its passkeys in the field's autofill and answers once one is picked. */
export async function autofillPasskey(options: Options): Promise<AuthenticationResponseJSON | null> {
  if (!passkeysSupported()) return null;
  try {
    return AuthenticationResponseJSON.parse(await startAuthentication({ optionsJSON: options as unknown as StartAuthenticationOpts["optionsJSON"], useBrowserAutofill: true }));
  } catch (err) {
    return quietOrRefused(err);
  }
}

/** Cancels the ceremony running in the browser, if any: the library's abort service, which a new ceremony also goes through. */
export function abortPasskeyRequest(): void {
  WebAuthnAbortService.cancelCeremony();
}

/**
 * How long a conditional request runs before it is renewed: a challenge lives 10 minutes, and conditional mediation
 * ignores the ceremony's timeout, so a request left alone would outlive its challenge.
 */
export const AUTOFILL_RESTART_MS = 9 * 60 * 1000;

/** What the sign-in screen does for the scheduler: run a request, cancel the ceremony in the browser, set a timer. */
export interface AutofillEffects {
  /** Fetches the options and runs the conditional request as run `run`; the screen reports how it ended through `ended`. */
  start(run: number): void;
  abort(): void;
  /** Runs `callback` after `ms`; the answer cancels it. */
  after(callback: () => void, ms: number): () => void;
}

export interface AutofillScheduler {
  /** The screen came into view: a request starts unless one runs already or the button's own request holds it. */
  focus(): void;
  /** The screen left the view: the request is aborted and none starts until the next focus. */
  blur(): void;
  /** The button's own request begins: the conditional one is aborted and none starts until release. */
  hold(): void;
  release(): void;
  /** The screen unmounts: a blur, for good. */
  dispose(): void;
  /** Whether `run` may still put a ceremony in the browser: false once it was aborted or renewed, so a run whose options arrive late starts nothing. */
  isCurrent(run: number): boolean;
  /** How run `run` ended; ignored for a run that is not current any more. Only an expired challenge starts a new run at once. */
  ended(run: number, reason: "expired" | "failed" | "done"): void;
}

/**
 * The one controller of the conditional request (1c design, section 9), pure so its schedule can be tested: at most
 * one run is current; it is renewed after AUTOFILL_RESTART_MS and after an expired challenge; it is aborted when the
 * screen loses focus, unmounts or runs the button's own request; and after any other ending nothing starts until the
 * next focus or release, so a refusal such as a rate limit cannot loop.
 */
export function createAutofillScheduler(effects: AutofillEffects): AutofillScheduler {
  let focused = false;
  let held = false;
  let disposed = false;
  let runs = 0;
  let current: number | null = null;
  let cancelTimer: (() => void) | null = null;

  // Ends the current run: its ceremony is aborted, and its own ending, which arrives later, is stale.
  function stop(): void {
    if (current === null) return;
    current = null;
    cancelTimer?.();
    cancelTimer = null;
    effects.abort();
  }

  function maybeStart(): void {
    if (disposed || !focused || held || current !== null) return;
    current = ++runs;
    cancelTimer = effects.after(() => {
      stop();
      maybeStart();
    }, AUTOFILL_RESTART_MS);
    effects.start(current);
  }

  return {
    focus() {
      focused = true;
      maybeStart();
    },
    blur() {
      focused = false;
      stop();
    },
    hold() {
      held = true;
      stop();
    },
    release() {
      held = false;
      maybeStart();
    },
    dispose() {
      disposed = true;
      stop();
    },
    isCurrent: (run) => current === run,
    ended(run, reason) {
      if (current !== run) return;
      current = null;
      cancelTimer?.();
      cancelTimer = null;
      if (reason === "expired") maybeStart();
    },
  };
}

/** How long "Not now" hides the home screen's suggestion on this device. */
export const SUGGESTION_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether the home screen suggests adding a passkey (1c design, section 9): none yet, a built-in authenticator to add
 * one with, and no "Not now" within the snooze. A dismissal from the future (a clock that moved) counts as recent.
 */
export function suggestPasskey(input: { passkeys: number; platformAuthenticator: boolean; dismissedAt: number | null; now: number }): boolean {
  if (input.passkeys > 0 || !input.platformAuthenticator) return false;
  return input.dismissedAt === null || input.now - input.dismissedAt >= SUGGESTION_SNOOZE_MS;
}

const SUGGESTION_KEY = "korbat.passkeySuggestion.dismissedAt";

/** Browser storage, typed locally as lib/api.ts types it; every access is guarded, since a private window or blocked storage throws. */
const web = globalThis as unknown as { localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void } };

/** When "Not now" was last chosen on this device, or null. */
export function suggestionDismissedAt(): number | null {
  try {
    const stored = Number(web.localStorage?.getItem(SUGGESTION_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

/** Records "Not now" on this device; one that cannot store it sees the card again next time. */
export function dismissSuggestion(now: number): void {
  try {
    web.localStorage?.setItem(SUGGESTION_KEY, String(now));
  } catch {
    // Nothing to do: the card comes back next time.
  }
}
