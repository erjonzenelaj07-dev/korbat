import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ReauthResponse, type MeResponse, type PasskeyView } from "@korbat/contracts";
import EmailRevert from "../src/app/email-revert/[token]";
import NotMe from "../src/app/not-me/[token]";
import PasskeyRemove from "../src/app/passkey-remove/[token]";
import { AddPasskeyDialog, PasskeyItem } from "../src/components/security/PasskeysSection";
import { methodsForLevel, panelStart, REENROLL_HINT, ReauthPanel, reauthNeeded, recoveryCodeSpent, ReenrollNotice, type Method } from "../src/components/security/ReauthPanel";
import { ApiError, apiResponse, messageFor } from "../src/lib/api";
import { AUTOFILL_RESTART_MS, createAutofillScheduler, SUGGESTION_SNOOZE_MS, suggestPasskey, type AutofillEffects } from "../src/lib/passkeys";
import { TERMS_SECTIONS } from "../src/lib/terms";

/**
 * The passkey screens (1c design, section 9): the sign-in autofill's schedule, the level-2 panel's choice, the home
 * card's rule and the messages are pure helpers and are called; the Security list's rows, the Add dialog and the
 * re-authentication panel are server-rendered as lifecycle.test.tsx renders the email-revert page; what a static
 * render cannot show (the sign-in screen's field and button, the pages' calls, the absence of the Signal API) is
 * read from the source, as a11y.test.tsx does.
 */
const SRC = path.resolve(import.meta.dirname, "..", "src");

/** The route parameters the page under test reads; each test sets them. */
const route = vi.hoisted(() => ({ params: {} as Record<string, string> }));

// expo-router cannot load in Node (it reaches React Native's own modules); Link with `asChild` hands the child its
// href, a page reads its route parameters, and nothing navigates in a static render.
vi.mock("expo-router", () => ({
  Link: ({ href, children }: { href: string; children: ReactElement }) => cloneElement(children, { href } as object),
  router: { replace: () => undefined, push: () => undefined, setParams: () => undefined },
  useLocalSearchParams: () => route.params,
  useFocusEffect: () => undefined,
}));
// The panel and the pages read the session only to refresh it after their call; a static render never makes one.
vi.mock("@/lib/session", () => ({ useSession: () => ({ refresh: async () => undefined }) }));

const html = (element: ReactElement): string => renderToStaticMarkup(element);

const read = (...parts: string[]): string => readFileSync(path.join(SRC, ...parts), "utf8");

/** Every source line matching `pattern`, as `file:line`. */
function findInSource(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of readdirSync(SRC, { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    const lines = readFileSync(path.join(SRC, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (pattern.test(line)) found.push(`${file.split(path.sep).join("/")}:${index + 1}`);
    });
  }
  return found.sort();
}

const noop = async () => undefined;
const TOKEN = "A".repeat(20) + "b_-".repeat(7) + "z".repeat(2);

/** Effects the scheduler drives, recorded: the runs it started, the aborts it asked for, and the timers it set. */
function fakeEffects() {
  const started: number[] = [];
  let aborts = 0;
  const timers: { callback: () => void; ms: number; cancelled: boolean }[] = [];
  const effects: AutofillEffects = {
    start: (run) => started.push(run),
    abort: () => {
      aborts += 1;
    },
    after: (callback, ms) => {
      const timer = { callback, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  return { effects, started, aborts: () => aborts, timers };
}

describe("the sign-in autofill's schedule", () => {
  test("starts one conditional request when the screen is focused, and never a second while it runs", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.focus();
    expect(fx.started).toEqual([1]);
    expect(scheduler.isCurrent(1)).toBe(true);
    // A challenge lives 10 minutes and conditional mediation ignores the ceremony's timeout, so the request is renewed before its challenge expires.
    expect(AUTOFILL_RESTART_MS).toBe(9 * 60 * 1000);
    expect(fx.timers.map((timer) => timer.ms)).toEqual([AUTOFILL_RESTART_MS]);
  });

  test("renews the request after 9 minutes: aborts it and starts another, and the old one's late ending changes nothing", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    fx.timers[0]!.callback();
    expect(fx.aborts()).toBe(1);
    expect(fx.started).toEqual([1, 2]);
    expect(scheduler.isCurrent(1)).toBe(false);
    expect(scheduler.isCurrent(2)).toBe(true);
    scheduler.ended(1, "expired");
    scheduler.ended(1, "failed");
    expect(fx.started).toEqual([1, 2]);
    expect(scheduler.isCurrent(2)).toBe(true);
  });

  test("starts over after the API said the challenge expired, and stops after any other failure or a sign-in until the next focus", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.ended(1, "expired");
    expect(fx.started).toEqual([1, 2]);
    expect(fx.timers[0]!.cancelled).toBe(true);
    scheduler.ended(2, "failed");
    expect(fx.started).toEqual([1, 2]);
    expect(scheduler.isCurrent(2)).toBe(false);
    scheduler.focus();
    expect(fx.started).toEqual([1, 2, 3]);
    scheduler.ended(3, "done");
    expect(fx.started).toEqual([1, 2, 3]);
    expect(fx.timers.every((timer) => timer.cancelled)).toBe(true);
    expect(fx.aborts()).toBe(0);
  });

  test("aborts the request when the screen loses focus, and starts a new one when it is focused again", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.blur();
    expect(fx.aborts()).toBe(0);
    scheduler.focus();
    scheduler.blur();
    expect(fx.aborts()).toBe(1);
    expect(scheduler.isCurrent(1)).toBe(false);
    expect(fx.timers[0]!.cancelled).toBe(true);
    // The aborted request's own ending arrives later and starts nothing while the screen is away.
    scheduler.ended(1, "expired");
    expect(fx.started).toEqual([1]);
    scheduler.focus();
    expect(fx.started).toEqual([1, 2]);
  });

  test("holds while the button's own request runs: options fetched meanwhile start no ceremony, and it resumes afterwards if still focused", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.hold();
    expect(fx.aborts()).toBe(1);
    expect(scheduler.isCurrent(1)).toBe(false);
    scheduler.release();
    expect(fx.started).toEqual([1, 2]);
    scheduler.hold();
    scheduler.blur();
    scheduler.release();
    expect(fx.started).toEqual([1, 2]);
    scheduler.focus();
    expect(fx.started).toEqual([1, 2, 3]);
    // A hold with nothing running aborts nothing.
    scheduler.ended(3, "failed");
    scheduler.hold();
    expect(fx.aborts()).toBe(2);
  });

  test("does nothing once it is disposed, whatever comes after", () => {
    const fx = fakeEffects();
    const scheduler = createAutofillScheduler(fx.effects);
    scheduler.focus();
    scheduler.dispose();
    expect(fx.aborts()).toBe(1);
    scheduler.focus();
    scheduler.release();
    scheduler.ended(1, "expired");
    expect(fx.started).toEqual([1]);
    expect(scheduler.isCurrent(1)).toBe(false);
  });
});

describe("the level-2 panel's choice from the factors the session proved", () => {
  const ALL: Method[] = ["password", "passkey", "totp", "email", "recovery"];

  test("level 1 offers every method the account has", () => {
    expect(methodsForLevel({ level: 1, have: [] }, ALL)).toEqual({ methods: ALL, missing: null });
    expect(methodsForLevel({ level: 1, have: ["email"] }, ["email"])).toEqual({ methods: ["email"], missing: null });
  });

  test("after a first factor, only a second one is offered: a passkey, an authenticator code or a recovery code", () => {
    for (const first of ["email", "password", "passkey"] as const) {
      expect(methodsForLevel({ level: 2, have: [first] }, ALL), first).toEqual({ methods: ["passkey", "totp", "recovery"], missing: "second" });
    }
  });

  test("with only a second factor, a first one is offered: the password, a passkey or an email code", () => {
    for (const second of ["totp", "recovery"] as const) {
      expect(methodsForLevel({ level: 2, have: [second] }, ALL), second).toEqual({ methods: ["password", "passkey", "email"], missing: "first" });
    }
  });

  test("with nothing proved in time, everything is offered", () => {
    expect(methodsForLevel({ level: 2, have: [] }, ALL)).toEqual({ methods: ALL, missing: null });
  });

  test("the account's own methods bound the choice, and a choice that would be empty falls back to all of them", () => {
    expect(methodsForLevel({ level: 2, have: ["password"] }, ["password", "totp", "email"])).toEqual({ methods: ["totp"], missing: "second" });
    expect(methodsForLevel({ level: 2, have: ["email"] }, ["password", "email"])).toEqual({ methods: ["password", "email"], missing: null });
  });

  test("the details of a refusal are read as the level and the factors, and anything else means level 1 with nothing proved", () => {
    expect(reauthNeeded(new ApiError(403, "reauth_required", "Confirm it's you to continue.", undefined, { level: 2, have: ["email", "totp"] }))).toEqual({ level: 2, have: ["email", "totp"] });
    expect(reauthNeeded(new ApiError(403, "reauth_required", "Confirm it's you to continue."))).toEqual({ level: 1, have: [] });
    expect(reauthNeeded(new ApiError(403, "reauth_required", "Confirm it's you to continue.", undefined, { level: 3, have: "email" }))).toEqual({ level: 1, have: [] });
  });
});

describe("the home screen's passkey suggestion", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse("2026-09-25T12:00:00Z");

  test("shows for an account without passkeys on a device with a built-in authenticator, unless Not now was chosen in the last 30 days", () => {
    expect(SUGGESTION_SNOOZE_MS).toBe(30 * DAY);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: null, now })).toBe(true);
    expect(suggestPasskey({ passkeys: 1, platformAuthenticator: true, dismissedAt: null, now })).toBe(false);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: false, dismissedAt: null, now })).toBe(false);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: now - 29 * DAY, now })).toBe(false);
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: now - 31 * DAY, now })).toBe(true);
    // A dismissal from the future (the clock moved) still counts as recent.
    expect(suggestPasskey({ passkeys: 0, platformAuthenticator: true, dismissedAt: now + DAY, now })).toBe(false);
  });
});

describe("the passkey messages", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("every new code has its sentence, and the daily bound says its wait in hours from the details", () => {
    expect(messageFor("passkey_invalid")).toBe("That passkey did not work. Try again or use your email.");
    expect(messageFor("passkey_unsupported")).toBe("This passkey provider is not supported. Try another one.");
    expect(messageFor("passkey_limit")).toBe("You have 10 passkeys. Remove one to add another.");
    expect(messageFor("passkey_limit", undefined, { reason: "cap" })).toBe("You have 10 passkeys. Remove one to add another.");
    expect(messageFor("passkey_limit", undefined, { reason: "daily", retryAfter: 7200 })).toBe("You added 5 passkeys today. You can add another in about 2 hours.");
    expect(messageFor("passkey_limit", undefined, { reason: "daily", retryAfter: 7201 })).toBe("You added 5 passkeys today. You can add another in about 3 hours.");
    expect(messageFor("passkey_limit", undefined, { reason: "daily", retryAfter: 1 })).toBe("You added 5 passkeys today. You can add another in about 1 hour.");
    expect(messageFor("passkey_suspended")).toBe("This passkey was switched off because a copy of it may exist. Remove it and add a new one.");
    expect(messageFor("challenge_expired")).toBe("That took too long. Try again.");
    expect(messageFor("passkey_not_found")).toBe("That passkey is gone.");
  });

  test("a refusal's details reach the error, and the daily bound is worded here from them rather than by the server", async () => {
    const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", answer(409, { error: { code: "passkey_limit", message: "server wording", details: { reason: "daily", retryAfter: 7200 } } }));
    await expect(apiResponse("/api/auth/passkeys/register/options", { json: { label: "alice" } })).rejects.toMatchObject({
      status: 409,
      code: "passkey_limit",
      message: "You added 5 passkeys today. You can add another in about 2 hours.",
      details: { reason: "daily", retryAfter: 7200 },
    });
    vi.stubGlobal("fetch", answer(403, { error: { code: "reauth_required", message: "Confirm it's you to continue.", details: { level: 2, have: ["password"] } } }));
    const refused = await apiResponse("/api/auth/passkeys/register/options", { json: { label: "alice" } }).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(ApiError);
    expect(reauthNeeded(refused as ApiError)).toEqual({ level: 2, have: ["password"] });
    // The server's own wording still stands for every other code.
    vi.stubGlobal("fetch", answer(401, { error: { code: "passkey_invalid", message: "server wording" } }));
    await expect(apiResponse("/api/auth/passkey/signin/verify", { json: {} })).rejects.toMatchObject({ code: "passkey_invalid", message: "server wording", details: undefined });
  });
});

describe("the Security screen's passkeys", () => {
  const view = (extra: Partial<PasskeyView> = {}): PasskeyView => ({
    id: "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f",
    name: "Laptop",
    createdAt: "2026-09-20T10:00:00.000Z",
    lastUsedAt: null,
    synced: false,
    createdOn: "Chrome on Windows",
    current: false,
    isNew: false,
    suspended: false,
    ...extra,
  });
  const row = (passkey: PasskeyView) => html(<PasskeyItem passkey={passkey} busy={false} onRename={async () => true} onRemove={() => undefined} onNotMine={() => undefined} />);

  test("a row shows the name, when it was added and last used, and the device that added it", () => {
    const out = row(view());
    expect(out).toContain("Laptop");
    expect(out).toContain("added ");
    expect(out).toContain("never used");
    expect(out).toContain("added on Chrome on Windows");
    expect(out).toContain("Rename");
    expect(out).toContain("Remove");
    expect(out).not.toMatch(/This wasn(&#x27;|')t me/);
    expect(out).not.toContain('role="img"');
    const gone = row(view({ createdOn: null, lastUsedAt: "2026-09-25T10:00:00.000Z" }));
    expect(gone).toContain("last used ");
    expect(gone).not.toContain("never used");
    expect(gone).not.toContain("added on");
  });

  test("each tag names itself for a screen reader as an image, since ARIA lets no generic element carry a name", () => {
    const out = row(view({ current: true, isNew: true, suspended: true, synced: true }));
    for (const label of [
      "used for this session: it signed you in here",
      "new: added in the last 7 days",
      "suspended: switched off because a copy of it may exist",
      "synced: backed up by your password manager to your other devices",
    ]) {
      const tag = new RegExp(`<div[^>]*aria-label="${label}"[^>]*>`).exec(out)?.[0] ?? "";
      expect(tag, label).toContain('role="img"');
    }
    expect(out).toMatch(/This wasn(&#x27;|')t me/);
  });

  test("the Add dialog labels both fields, prefills the password manager's name with the handle and says what that name reveals", () => {
    const out = html(<AddPasskeyDialog handle="alice" busy={false} error={null} onCreate={noop} onCancel={() => undefined} />);
    expect(out).toContain('role="dialog"');
    expect(out).toMatch(/<input[^>]*aria-label="Name"[^>]*>/);
    const label = /<input[^>]*aria-label="Name in your password manager"[^>]*>/.exec(out)?.[0] ?? "";
    expect(label).toContain('value="alice"');
    expect(out).toContain("Your password manager shows this name to anyone who can see this device.");
    expect(out).toContain("Create passkey");
    expect(out).toContain("Cancel");
  });

  test("the screen shows the section, opens the Add dialog from the home card's link, and turns two-factor off without a code", () => {
    const security = read("app", "settings", "security.tsx");
    expect(security).toContain('<Section title="Passkeys">');
    expect(security).toContain('openAdd={add === "1"}');
    const mfa = read("components", "security", "MfaSection.tsx");
    expect(mfa).toContain('api("/api/auth/mfa/totp/disable", { json: {} })');
    expect(mfa).not.toMatch(/totp\/disable", \{ json: \{ code/);
    const home = read("app", "index.tsx");
    expect(home).toContain("<PasskeySuggestion");
    expect(home).toContain('router.push("/settings/security?add=1")');
  });

  test("a staff account without two-factor is told what it protects in the app, and that staff tools open only on the console with a staff key", () => {
    // 3a design, section 13, Task 4: two-factor in the app gives no staff power, so the sentence promises none.
    const mfa = read("components", "security", "MfaSection.tsx");
    expect(mfa).toContain(
      "Two-factor authentication is off. Turn it on so a leaked password or email alone can't open your account; on a staff account it then stays on. Staff tools are on the staff console and open only with a staff key.",
    );
    expect(mfa).not.toContain("before using staff tools");
  });
});

describe("the re-authentication panel", () => {
  const me: MeResponse = {
    user: { id: "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f", email: "alice@example.org", role: "user", onboarded: true, mfaEnabled: true, hasPassword: true, passkeys: 1 },
    profile: null,
    standing: null,
  };
  /** The method chips, in order: each is a pressed or unpressed native button. */
  const chips = (out: string): string[] => [...out.matchAll(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1] ?? "");

  test("offers the recovery code beside the other methods, and the passkey only in a browser that supports it, which Node is not", () => {
    const out = html(<ReauthPanel me={me} pending={{ action: noop, needed: { level: 1, have: [] } }} onClose={() => undefined} />);
    expect(chips(out)).toEqual(["Password", "Authenticator code", "Email code", "Recovery code"]);
    expect(out).not.toContain("This change needs two factors");
    const source = read("components", "security", "ReauthPanel.tsx");
    expect(source).toContain('label="Use a passkey"');
    expect(source).toContain('method: "passkey"');
    expect(source).toContain('method: "recovery"');
    expect(source).toContain("me.user.passkeys > 0 && passkeysSupported()");
  });

  test("at level 2 it says why and asks only for what is missing", () => {
    const out = html(<ReauthPanel me={me} pending={{ action: noop, needed: { level: 2, have: ["password"] } }} onClose={() => undefined} />);
    expect(out).toContain("This change needs two factors because two-factor authentication is on.");
    expect(chips(out)).toEqual(["Authenticator code", "Recovery code"]);
    const first = html(<ReauthPanel me={me} pending={{ action: noop, needed: { level: 2, have: ["totp"] } }} onClose={() => undefined} />);
    expect(chips(first)).toEqual(["Password", "Email code"]);
  });

  test("closing the panel never replaces the route, which would mount the screen anew and lose what the action just showed: the hint is a parameter set on the route the screen is on", () => {
    const source = read("components", "security", "ReauthPanel.tsx");
    // A replace builds a route with a new key: the new recovery codes, a setup's QR code and the flow id of a mailed code would go with the old one.
    expect(source).not.toMatch(/router\.(replace|push|navigate)\(/);
    expect(source.match(/router\.setParams\(\{ reenroll: "1" \}\)/g)).toHaveLength(1);
    // Security reads the parameter where it stands and hands it to the two-factor section; Account and Profile show the notice.
    const security = read("app", "settings", "security.tsx");
    expect(security).toContain("useLocalSearchParams<{ reenroll?: string; add?: string }>()");
    expect(security).toContain('reenroll={reenroll === "1"}');
    for (const screen of ["account.tsx", "profile.tsx"]) expect(read("app", "settings", screen), screen).toContain("<ReenrollNotice me={me} />");
  });

  test("on a screen without a two-factor section the hint is a notice with a link to Security, shown when the parameter is set and two-factor is on", () => {
    route.params = { reenroll: "1" };
    const out = html(<ReenrollNotice me={me} />);
    expect(out).toContain(REENROLL_HINT);
    expect(out).toMatch(/<a[^>]*href="\/settings\/security\?reenroll=1"[^>]*>/);
    // One sentence on the three screens: Security's own, which its two-factor section shows.
    expect(REENROLL_HINT).toBe("You used a recovery code. Set up two-factor again to get a fresh set of codes.");
    expect(read("components", "security", "MfaSection.tsx")).toContain(REENROLL_HINT);
    route.params = {};
    expect(html(<ReenrollNotice me={me} />)).toBe("");
    route.params = { reenroll: "0" };
    expect(html(<ReenrollNotice me={me} />)).toBe("");
    // Without two-factor there is nothing to set up again, as on Security.
    route.params = { reenroll: "1" };
    expect(html(<ReenrollNotice me={{ ...me, user: { ...me.user, mfaEnabled: false } }} />)).toBe("");
    route.params = {};
  });

  test("a spent recovery code is remembered for the panel's life: whichever answer carried it, and whether or not the action then went through, the panel closes with the hint", () => {
    const spent = (answers: unknown[]): boolean => answers.map((answer) => ReauthResponse.parse(answer)).reduce(recoveryCodeSpent, false);
    // At level 2 with nothing proved in time: the recovery code first, after which the action is refused again, then the password.
    expect(spent([{ level: 1, mustReenrollMfa: true }, { level: 2 }])).toBe(true);
    // The password first, then the recovery code.
    expect(spent([{ level: 1 }, { level: 2, mustReenrollMfa: true }])).toBe(true);
    // A recovery code, after which the action fails for a reason of its own: the panel stays open with the error and closes by Cancel.
    expect(spent([{ level: 2, mustReenrollMfa: true }])).toBe(true);
    // No recovery code, no hint.
    expect(spent([{ level: 1 }, { level: 2 }])).toBe(false);
    expect(spent([{ level: 2, mustReenrollMfa: false }])).toBe(false);
    expect(spent([])).toBe(false);

    const source = read("components", "security", "ReauthPanel.tsx");
    // Held in a ref, which outlives one answer, and read from every answer before the action runs.
    expect(source).toContain("const recoveryUsed = useRef(false);");
    expect(source).toContain("recoveryUsed.current = recoveryCodeSpent(recoveryUsed.current, result);");
    expect(source.indexOf("recoveryUsed.current = recoveryCodeSpent(")).toBeLessThan(source.indexOf("await pending.action();"));
    // Acted on in one place, which both ways out of the panel go through: the action that went through, and Cancel.
    expect(source).toMatch(/function close\(\) \{\s*onClose\(\);\s*if \(recoveryUsed\.current\) router\.setParams\(\{ reenroll: "1" \}\);\s*\}/);
    expect(source).toContain('<Button label="Cancel" onPress={close} tone="secondary" />');
    expect(source.match(/^\s*close\(\);$/gm)).toHaveLength(1);
    expect(source).not.toMatch(/onPress=\{onClose\}/);
    expect(source.match(/\bonClose\(\)/g)).toHaveLength(1);
  });

  test("the panel follows the refusal it is answering: when another action's refusal replaces the one it shows, it starts over from what that one needs", () => {
    const available: Method[] = ["password", "totp", "email", "recovery"];
    // A level-2 action refused after the password: the two-factor sentence, and second factors only.
    expect(methodsForLevel({ level: 2, have: ["password"] }, available)).toEqual({ methods: ["totp", "recovery"], missing: "second" });
    expect(panelStart({ level: 2, have: ["password"] }, available)).toEqual({ needed: { level: 2, have: ["password"] }, method: "totp", value: "", flowId: null, error: null });
    // "This wasn't me" or "Sign out everywhere" refused while that panel is open: level 1 with nothing proved in time, so
    // every method the account has, the password and the email code among them, and nothing typed, mailed or refused yet.
    expect(methodsForLevel({ level: 1, have: [] }, available)).toEqual({ methods: available, missing: null });
    expect(panelStart({ level: 1, have: [] }, available)).toEqual({ needed: { level: 1, have: [] }, method: "password", value: "", flowId: null, error: null });

    const source = read("components", "security", "ReauthPanel.tsx");
    // The panel is one instance whatever refusal it shows (the screens give it no key), so it compares the refusal it
    // started from with the one it is given, and starts over when they differ.
    expect(source).toContain("const [asked, setAsked] = useState(pending);");
    const reset = /if \(asked !== pending\) \{([^}]*)\}/.exec(source)?.[1] ?? "";
    for (const line of ["const next = panelStart(pending.needed, available);", "setAsked(pending);", "setNeeded(next.needed);", "setMethod(next.method);", "setValue(next.value);", "setFlowId(next.flowId);", "setError(next.error);"]) {
      expect(reset, line).toContain(line);
    }
    // The focus moves to the panel for every refusal, not only the first.
    expect(source).toMatch(/\.focus\?\.\(\);\s*\}, \[pending\]\);/);
    for (const screen of ["security.tsx", "account.tsx", "profile.tsx"]) {
      expect(read("app", "settings", screen), screen).toContain("{reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}");
    }
  });
});

describe("the sign-in screen", () => {
  const signin = read("app", "(auth)", "signin.tsx");

  test("the email field carries the autofill pair, and the passkey button sends the response with the device fields the password sign-in sends", () => {
    expect(signin).toContain('const EMAIL_AUTOFILL = "email webauthn" as unknown as TextInputProps["autoComplete"];');
    expect(signin).toMatch(/<Field label="Email" autoComplete=\{EMAIL_AUTOFILL\}/);
    expect(signin).toContain('label="Sign in with a passkey"');
    expect(signin).toContain('api("/api/auth/passkey/signin/verify", { json: { response, deviceId: deviceId(), platform }, schema: SignInResponse })');
    expect(signin).toContain('router.replace("/mfa")');
  });

  test("one controller owns the conditional request: focus and blur drive it, and unmounting disposes of it", () => {
    expect(signin).toContain("createAutofillScheduler(");
    expect(signin).toContain("useFocusEffect(");
    expect(signin).toMatch(/scheduler\.blur\(\)/);
    expect(signin).toMatch(/scheduler\.dispose\(\)/);
    expect(signin).toMatch(/scheduler\.hold\(\)/);
  });

  test("no screen calls the Signal API, which deletes other accounts' passkeys on Safari", () => {
    expect(findInSource(/signalUnknownCredential|signalAllAcceptedCredentials|signalCurrentUserDetails|sendSignal\(/)).toEqual([]);
  });
});

describe("the pages behind the links", () => {
  /** The opening tag of the button whose text is `label`, or "" when there is none. */
  const buttonTag = (markup: string, label: string): string => {
    const at = markup.indexOf(label);
    const role = at === -1 ? -1 : markup.lastIndexOf('role="button"', at);
    return role === -1 ? "" : markup.slice(markup.lastIndexOf("<", role), markup.indexOf(">", role) + 1);
  };
  // The lockdown reaches from the day before its anchor to the moment it runs, which can be a week later: "since", never "in".
  const LOCKDOWN = /passkeys and two-factor authentication set up since the day before/;
  /** A page before the confirmation and after it: the second render starts from the state the confirmation leaves. */
  const sentences = (source: string): string[] => source.replace(/\s+/g, " ").match(/[^.]*set up (?:since|in) the day before[^.;]*/g) ?? [];

  test("the passkey-remove page explains the lockdown, confirms, and offers the button only with the link's token", () => {
    route.params = { token: TOKEN };
    const out = html(<PasskeyRemove />);
    const label = "Remove the passkey and lock down my account";
    expect(out).toContain(label);
    expect(out).toMatch(/sign(s|ed)? out every session/i);
    expect(out).toMatch(LOCKDOWN);
    expect(buttonTag(out, label)).not.toBe("");
    expect(buttonTag(out, label)).not.toContain('aria-disabled="true"');
    expect(out).not.toContain('role="alert"');
    for (const token of ["", "short", "A".repeat(42) + "/"]) {
      route.params = { token };
      const bad = html(<PasskeyRemove />);
      expect(bad, token).toContain('role="alert"');
      expect(bad, token).toMatch(/link is incomplete/);
      expect(buttonTag(bad, label), token).toContain('aria-disabled="true"');
    }
    const source = read("app", "passkey-remove", "[token].tsx");
    expect(source).toContain('api("/api/auth/passkeys/remove-link", { json: { token } })');
    expect(source).toMatch(/router\.replace\("\/signin"\)/);
  });

  test("the not-me and email-undo pages describe the lockdown: every session out, the password removed, and what was set up since the day before", () => {
    route.params = { token: TOKEN };
    for (const [name, page] of [
      ["not-me", <NotMe />],
      ["email-revert", <EmailRevert />],
    ] as const) {
      const out = html(page);
      expect(out, name).toMatch(/sign(s|ed)? out every session/i);
      expect(out, name).toMatch(/remove (your|any) password/i);
      expect(out, name).toMatch(LOCKDOWN);
    }
  });

  test("every explanation of the lockdown names its reach as it is, before the confirmation and after it: what was set up since the day before, the person's own later additions included", () => {
    const anchors = { "passkey-remove": ["PASSKEY_REMOVE_WORDS", "it was added"], "not-me": ["NOT_ME_WORDS", "that sign-in"], "email-revert": ["EMAIL_REVERT_WORDS", "the change"] };
    for (const [page, [words, anchor]] of Object.entries(anchors)) {
      // UI Task 8 (section 1.5): the sentences live in lib/lockdown-words.ts, one block per page, which the page reads.
      const found = sentences(lockdownBlock(words!));
      expect(read("app", page, "[token].tsx"), page).toContain(`${words}.`);
      expect(found, page).toHaveLength(2); // Twice on each page: what confirming will do, and what it did.
      for (const sentence of found) expect(sentence, page).toContain(`passkeys and two-factor authentication set up since the day before ${anchor}`);
    }
    const dialog = sentences(lockdownBlock("NOT_MINE_WORDS")); // The dialog behind "This wasn't me", whose passkey can be a week old by then.
    expect(read("components", "security", "PasskeysSection.tsx")).toContain("NOT_MINE_WORDS.");
    expect(dialog).toHaveLength(1);
    expect(dialog[0]).toContain("every passkey and two-factor authentication set up since the day before this passkey was added is removed, including any you set up yourself after it");
    // Nowhere does the app say "in the day before", which names one day of what can be eight.
    expect(findInSource(/in the day before/)).toEqual([]);
  });
});

/** UI Task 8: one block of lib/lockdown-words.ts, from its export to its closing brace. */
function lockdownBlock(name: string): string {
  const words = read("lib", "lockdown-words.ts");
  const from = words.indexOf(`export const ${name} = {`);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return words.slice(from, words.indexOf(`${String.fromCharCode(10)}};`, from));
}

describe("the terms", () => {
  test("say what a passkey keeps on the server and that nothing about fingerprints or faces leaves the device", () => {
    const body = TERMS_SECTIONS.find((section) => section.title === "Your data")?.body ?? "";
    expect(body).toMatch(/passkey/);
    expect(body).toMatch(/public key/);
    expect(body).toMatch(/the device that added it/);
    expect(body).toMatch(/fingerprint/);
    expect(body).toMatch(/face/);
  });
});
