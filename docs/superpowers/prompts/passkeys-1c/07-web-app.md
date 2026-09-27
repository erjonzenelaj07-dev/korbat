# korbat passkeys (1c) — Task 7 of 9: The web app's passkey screens: a passkey button and conditional-mediation autofill on sign-in, the Passkeys section of Security (list with tags, rename, remove, 'This wasn't me', the add dialog with the password-manager name), the re-authentication panel's passkey and recovery-code methods and its level-2 choice, the home screen's suggestion card, the passkey-remove page and the lockdown texts on the not-me and email-undo pages, TOTP disable without a code, and the terms' passkey sentence; the whole stack rebuilt and smoke-tested

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-25 to 2026-09-27 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

This task delivers the web app's side of passkeys on the finished API: a passkey button and conditional-mediation autofill on the sign-in screen; the Passkeys section of Security (the list with its tags, rename, remove, 'This wasn't me' behind its explanation, and the add dialog with the name the password manager shows); the re-authentication panel's passkey and recovery-code methods and its level-2 choice from what the refusal says is missing; the home screen's suggestion card; the passkey-remove page and the lockdown texts on the not-me and email-undo pages; TOTP disable without a code; and the terms' passkey sentence. Its gates rebuild the whole stack and run the smoke test through Caddy.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Ports 3000 and 8080 on localhost must be free. Stop any korbat API, worker or web process started from this repository first; never stop other Node processes on the machine, and never touch Docker containers, volumes or images that do not belong to the `korbat` compose project.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(api,contracts): deletion and export cover passkeys: takeDown and finishTakeDown delete the account's passkeys and clear its WebAuthn user handle inside their transaction, and a deleted account's passkey stays refused after the take-down and the purge; the export lists the passkeys (name, dates, synced, the adding device) with no key material, credential id, AAGUID or id, in ExportFormat.account.passkeys, byte-identical to the streamed document`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/07-web-app.md 1
```

Expected: 1 line starting with `wrote`, one for each file below.

### Create `apps/app/test/passkeys.test.tsx`

```tsx
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MeResponse, PasskeyView } from "@korbat/contracts";
import EmailRevert from "../src/app/email-revert/[token]";
import NotMe from "../src/app/not-me/[token]";
import PasskeyRemove from "../src/app/passkey-remove/[token]";
import { AddPasskeyDialog, PasskeyItem } from "../src/components/security/PasskeysSection";
import { methodsForLevel, ReauthPanel, reauthNeeded, type Method } from "../src/components/security/ReauthPanel";
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
  router: { replace: () => undefined, push: () => undefined },
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
});

describe("the re-authentication panel", () => {
  const me: MeResponse = {
    user: { id: "0f7b3c2e-4a1d-4c6b-9e8f-1a2b3c4d5e6f", email: "alice@example.org", role: "user", onboarded: true, mfaEnabled: true, hasPassword: true, passkeys: 1 },
    profile: null,
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
  const LOCKDOWN = /passkeys and two-factor authentication set up in the day before/;

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

  test("the not-me and email-undo pages describe the lockdown: every session out, the password removed, and what was set up the day before", () => {
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
});

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
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/app test
```

Expected: the command exits with an error, and the output contains:

- `Tests  `
- `failed`

Observed on the dry run:

```text
Test Files  1 failed | 3 passed (4)
Tests  32 passed (32)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/passkeys-1c/write_blocks.py docs/superpowers/prompts/passkeys-1c/07-web-app.md 3
```

Expected: 12 lines starting with `wrote`, one for each file below.

### Create `apps/app/src/app/passkey-remove/[token].tsx`

```tsx
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Body, Button, ErrorText, Screen, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

/**
 * Opened from the link in the "passkey added" notice (1c design, section 7.6). The link is the only credential
 * needed; it works for 7 days, and still once the passkey is gone. Nothing happens until the person confirms.
 */
export default function PasskeyRemove() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/passkeys/remove-link", { json: { token } });
      setDone(true);
      // This browser's own session, if it had one, was signed out with the others.
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Title>Your account is locked down</Title>
        <Body>
          The passkey is removed. Every session is signed out, your password is removed, and any passkeys and two-factor authentication set up in the day before it was added
          are removed. Sign in again with a code sent to your email, then set a new password and turn on two-factor authentication.
        </Body>
        <Button label="Sign in" onPress={() => router.replace("/signin")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Remove this passkey</Title>
      <Body>
        If you did not add this passkey to your korbat account, confirm below. We'll remove it, sign out every session, including this browser, remove your password, and
        remove any passkeys and two-factor authentication set up in the day before it was added, so only someone with your email can get back in.
      </Body>
      <ErrorText message={valid ? error : "This link is incomplete. Open it again from the email."} />
      <Button label="Remove the passkey and lock down my account" onPress={() => void confirm()} busy={busy} disabled={!valid} tone="danger" />
      <TextLink label="It was me, go back" href="/" replace />
    </Screen>
  );
}
```

### Create `apps/app/src/components/security/PasskeysSection.tsx`

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { z } from "zod";
import { PasskeyListResponse, PasskeyOptionsResponse, PasskeyView, type MeResponse } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Notice } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { createPasskey, passkeysSupported } from "@/lib/passkeys";

type Run = (action: () => Promise<void>) => Promise<void>;
type Refresh = () => Promise<unknown>;

/** What the registration's verify and a rename answer: the passkey as the list shows it. */
const PasskeyResponse = z.object({ passkey: PasskeyView });

/** The PasskeyName contract's limit (the display-name rules). */
const NAME_MAX = 50;

/** The separator of a row's facts, the middle dot the sessions list uses, spelled by its code so the file stays ASCII. */
const DOT = " " + String.fromCharCode(183) + " ";

/** Ids come from the API's list; only a UUID may become part of a path. */
const passkeyPath = (id: string) => `/api/auth/passkeys/${encodeURIComponent(z.uuid().parse(id))}`;

/**
 * A short tag beside a passkey's name. It is an image to assistive technology, as the verified chip is: ARIA forbids
 * naming a generic element, and the label says what the one word means.
 */
function Tag({ label, meaning, tone = "plain" }: { label: string; meaning: string; tone?: "plain" | "good" | "bad" }) {
  const surface = tone === "good" ? "bg-emerald-950" : tone === "bad" ? "bg-red-950" : "bg-zinc-800";
  const text = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-zinc-300";
  return (
    <View role="img" accessibilityLabel={`${label}: ${meaning}`} className={`rounded-full px-2 py-0.5 ${surface}`}>
      <Text className={`text-xs font-medium ${text}`}>{label}</Text>
    </View>
  );
}

/** A small action inside a row, an underlined text like the sessions list's Sign out. */
function RowButton({ label, onPress, disabled, tone = "plain" }: { label: string; onPress: () => void; disabled: boolean; tone?: "plain" | "danger" }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} className="mr-4 py-1">
      <Text className={`text-sm underline ${disabled ? "text-zinc-500" : tone === "danger" ? "text-red-400" : "text-zinc-300"}`}>{label}</Text>
    </Pressable>
  );
}

/** One passkey of the list: its name and tags, its dates and device, and its actions; the rename is a field in place. */
export function PasskeyItem({
  passkey,
  busy,
  onRename,
  onRemove,
  onNotMine,
}: {
  passkey: PasskeyView;
  busy: boolean;
  /** Answers whether the new name was saved; the field stays for a retry otherwise. */
  onRename: (name: string) => Promise<boolean>;
  onRemove: () => void;
  onNotMine: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(passkey.name);
  const trimmed = name.trim();
  const ready = trimmed.length > 0 && trimmed.length <= NAME_MAX && trimmed !== passkey.name;

  // Enter in the field saves as the button does, so the button's conditions come first.
  async function save() {
    if (!ready || busy) return;
    if (await onRename(trimmed)) setRenaming(false);
  }

  return (
    <View className="mt-3 rounded-lg border border-zinc-800 px-4 py-3">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-base text-zinc-50">{passkey.name}</Text>
        {passkey.current ? <Tag label="used for this session" meaning="it signed you in here" tone="good" /> : null}
        {passkey.isNew ? <Tag label="new" meaning="added in the last 7 days" /> : null}
        {passkey.suspended ? <Tag label="suspended" meaning="switched off because a copy of it may exist" tone="bad" /> : null}
        {passkey.synced ? <Tag label="synced" meaning="backed up by your password manager to your other devices" /> : null}
      </View>
      <Text className="mt-1 text-xs text-zinc-400">
        added {new Date(passkey.createdAt).toLocaleDateString()}
        {DOT}
        {passkey.lastUsedAt ? `last used ${new Date(passkey.lastUsedAt).toLocaleString()}` : "never used"}
        {passkey.createdOn ? `${DOT}added on ${passkey.createdOn}` : null}
      </Text>
      {renaming ? (
        <>
          <Field label="Name" autoComplete="off" maxLength={NAME_MAX} value={name} onChangeText={setName} onSubmitEditing={() => void save()} />
          <View className="mt-2 flex-row flex-wrap">
            <RowButton label="Save" onPress={() => void save()} disabled={!ready || busy} />
            <RowButton
              label="Cancel"
              onPress={() => {
                setRenaming(false);
                setName(passkey.name);
              }}
              disabled={busy}
            />
          </View>
        </>
      ) : (
        <View className="mt-2 flex-row flex-wrap">
          <RowButton
            label="Rename"
            onPress={() => {
              // The field starts from the name the list shows now, not from an earlier edit.
              setName(passkey.name);
              setRenaming(true);
            }}
            disabled={busy}
          />
          <RowButton label="Remove" onPress={onRemove} disabled={busy} tone="danger" />
          {passkey.isNew ? <RowButton label="This wasn't me" onPress={onNotMine} disabled={busy} tone="danger" /> : null}
        </View>
      )}
    </View>
  );
}

/**
 * The dialog behind Add a passkey (1c design, section 9): the name korbat shows, optional, and the name the password
 * manager shows, prefilled with the handle, with one sentence on what that name reveals. Nothing is sent until Create.
 */
export function AddPasskeyDialog({
  handle,
  busy,
  error,
  onCreate,
  onCancel,
}: {
  handle: string;
  busy: boolean;
  error: string | null;
  onCreate: (name: string | undefined, label: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [label, setLabel] = useState(handle);
  const dialog = useRef<View>(null);
  // The dialog appears in reply to the Add button; the focus moves to it so the keyboard and a screen reader find it.
  useEffect(() => {
    (dialog.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, []);
  const ready = label.trim().length > 0 && label.trim().length <= NAME_MAX && name.trim().length <= NAME_MAX;

  // Enter in a field creates as the button does, so the button's conditions come first.
  async function create() {
    if (!ready || busy) return;
    await onCreate(name.trim().length > 0 ? name.trim() : undefined, label.trim());
  }

  return (
    <View ref={dialog} role="dialog" aria-labelledby="add-passkey-title" tabIndex={-1} className="mt-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <Text nativeID="add-passkey-title" accessibilityRole="header" aria-level={3} className="text-base font-semibold text-zinc-50">
        Add a passkey
      </Text>
      <Text className="mt-1 text-sm text-zinc-400">Your browser or password manager will ask you to confirm with your fingerprint, face, PIN or security key.</Text>
      <Field label="Name" autoComplete="off" maxLength={NAME_MAX} placeholder="For example Laptop or Phone" value={name} onChangeText={setName} />
      <Text className="mt-1 text-xs text-zinc-400">Optional: what korbat calls this passkey in the list.</Text>
      <Field label="Name in your password manager" autoComplete="off" maxLength={NAME_MAX} value={label} onChangeText={setLabel} onSubmitEditing={() => void create()} />
      <Text className="mt-1 text-xs text-zinc-400">Your password manager shows this name to anyone who can see this device.</Text>
      <ErrorText message={error} />
      <Button label="Create passkey" onPress={() => void create()} busy={busy} disabled={!ready} />
      <Button label="Cancel" onPress={onCancel} tone="secondary" />
    </View>
  );
}

/**
 * The Passkeys section of the Security screen (1c design, sections 7.3 and 7.5): the list, Add a passkey, Rename,
 * Remove, and "This wasn't me" on a new passkey, which explains the lockdown before running it. Adding and removing may
 * need level 2 on an account with two-factor, so they run through the re-authentication hook.
 */
export function PasskeysSection({ me, run, refresh, openAdd }: { me: MeResponse; run: Run; refresh: Refresh; openAdd: boolean }) {
  const supported = passkeysSupported();
  const [passkeys, setPasskeys] = useState<PasskeyView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The home screen's card opens the dialog at once; without support there is nothing to open.
  const [adding, setAdding] = useState(openAdd && supported);
  const [notMine, setNotMine] = useState<PasskeyView | null>(null);
  const lockdownDialog = useRef<View>(null);
  // The lockdown question appears in reply to "This wasn't me"; the focus moves to it so the keyboard and a screen reader find it.
  useEffect(() => {
    if (notMine) (lockdownDialog.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, [notMine]);

  const load = useCallback(async () => {
    try {
      setPasskeys((await api("/api/auth/passkeys", { schema: PasskeyListResponse })).passkeys);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** One request at a time for the section, through the re-authentication hook; answers whether the action went through, with its failure shown where `show` puts it. */
  async function act(action: () => Promise<void>, show: (message: string) => void = setError): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setDialogError(null);
    setDone(null);
    try {
      await run(action);
      return true;
    } catch (err) {
      show(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** A verify that fails after the browser created the passkey leaves one in the password manager that korbat does not know; the message says so. */
  function kept(err: unknown): ApiError {
    const sentence = " Your password manager may have kept a passkey that korbat does not know; you can delete it there.";
    return err instanceof ApiError ? new ApiError(err.status, err.code, err.message + sentence, err.retryAfter, err.details) : new ApiError(0, "internal", errorMessage(err) + sentence);
  }

  const create = (name: string | undefined, label: string) =>
    act(async () => {
      const { options } = await api("/api/auth/passkeys/register/options", { json: { label }, schema: PasskeyOptionsResponse });
      const response = await createPasskey(options);
      // The prompt was closed: the dialog stays, with nothing to say.
      if (response === null) return;
      try {
        await api("/api/auth/passkeys/register/verify", { json: { ...(name ? { name } : {}), response }, schema: PasskeyResponse });
      } catch (err) {
        throw kept(err);
      }
      setAdding(false);
      setDone("Passkey added. An email about it is on its way, with a link that removes it in case this was not you.");
      await load();
      // The count in the session decides whether the home screen suggests a passkey and the panel offers one.
      await refresh();
    }, setDialogError);

  const rename = (passkey: PasskeyView, name: string) =>
    act(async () => {
      await api(passkeyPath(passkey.id), { method: "PATCH", json: { name }, schema: PasskeyResponse });
      await load();
    });

  const remove = (passkey: PasskeyView) =>
    act(async () => {
      await api(passkeyPath(passkey.id), { method: "DELETE" });
      setDone(`The passkey named ${passkey.name} was removed.`);
      await load();
      await refresh();
    });

  const lockDown = (passkey: PasskeyView) =>
    act(async () => {
      await api(`${passkeyPath(passkey.id)}/not-mine`, { method: "POST" });
      // The API signed this session out with every other and cleared its cookies; the session reloads as signed out.
      await refresh();
      router.replace("/signin");
    });

  return (
    <View>
      <Body>A passkey signs you in with your fingerprint, face, PIN or a security key, and cannot be phished. You can have up to 10.</Body>
      {passkeys === null ? <Text className="mt-3 text-sm text-zinc-400">Loading passkeys...</Text> : null}
      {passkeys?.length === 0 ? <Text className="mt-3 text-sm text-zinc-400">You have no passkeys yet.</Text> : null}
      {passkeys?.map((passkey) => (
        <PasskeyItem key={passkey.id} passkey={passkey} busy={busy} onRename={(name) => rename(passkey, name)} onRemove={() => void remove(passkey)} onNotMine={() => setNotMine(passkey)} />
      ))}
      {notMine ? (
        <View ref={lockdownDialog} role="dialog" aria-labelledby="not-mine-title" tabIndex={-1} className="mt-4 rounded-lg border border-red-900 bg-zinc-900 p-4">
          <Text nativeID="not-mine-title" accessibilityRole="header" aria-level={3} className="text-base font-semibold text-zinc-50">
            Lock down your account?
          </Text>
          <Text className="mt-1 text-sm text-zinc-300">
            If you did not add the passkey named {notMine.name}, confirm below. Every session is signed out, including this browser, your password is removed, and anything
            set up in the day before this passkey (other passkeys and two-factor authentication) is removed, so only someone with your email can get back in.
          </Text>
          <Button label="Sign out everywhere and lock down" onPress={() => void lockDown(notMine)} busy={busy} tone="danger" />
          <Button label="Cancel" onPress={() => setNotMine(null)} tone="secondary" />
        </View>
      ) : null}
      <ErrorText message={error} />
      <Notice message={done} />
      {!supported ? (
        <Body>This browser cannot add a passkey. Use a recent browser on a device with a screen lock, or a password manager that stores passkeys.</Body>
      ) : adding ? (
        <AddPasskeyDialog
          handle={me.profile?.handle ?? ""}
          busy={busy}
          error={dialogError}
          onCreate={async (name, label) => {
            await create(name, label);
          }}
          onCancel={() => {
            setAdding(false);
            setDialogError(null);
          }}
        />
      ) : (
        <Button label="Add a passkey" onPress={() => setAdding(true)} tone="secondary" />
      )}
    </View>
  );
}
```

### Create `apps/app/src/lib/passkeys.ts`

```ts
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
```

### Replace `apps/app/src/app/(auth)/signin.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { View, type TextInputProps } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { FlowResponse, PasskeyOptionsResponse, SignInResponse, type AuthenticationResponseJSON } from "@korbat/contracts";
import { Body, Button, ErrorText, Field, Screen, TextLink, Title } from "@/components/ui";
import { api, ApiError, deviceId, errorMessage, platform } from "@/lib/api";
import { flow } from "@/lib/flow";
import { abortPasskeyRequest, autofillPasskey, autofillSupported, confirmWithPasskey, createAutofillScheduler, passkeysSupported } from "@/lib/passkeys";
import { useSession } from "@/lib/session";

const SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "";

/** The browser offers the passkeys it holds in the email field's autofill when the field's autocomplete ends with "webauthn"; React Native's type does not list the pair. */
const EMAIL_AUTOFILL = "email webauthn" as unknown as TextInputProps["autoComplete"];

type Outcome = "done" | "expired" | "failed";

/** The single entry point: one email field for both sign-up and sign-in, and a passkey where the browser has them. */
export default function EmailEntry() {
  const { refresh } = useSession();
  const turnstile = useRef<TurnstileInstance | null>(null);
  const [email, setEmail] = useState(flow.get().email ?? "");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Decided once: the button and the autofill exist only in a browser with WebAuthn.
  const [passkeys] = useState(passkeysSupported);

  /**
   * Verifies a passkey's response as the password sign-in handles its answer: a session, or the TOTP step with its
   * ticket. Answers how it ended, for the autofill's schedule.
   */
  const signIn = useCallback(
    async (response: AuthenticationResponseJSON): Promise<Outcome> => {
      try {
        const result = await api("/api/auth/passkey/signin/verify", { json: { response, deviceId: deviceId(), platform }, schema: SignInResponse });
        if (result.result === "mfa_required") {
          flow.set({ mfaTicket: result.mfaTicket });
          router.replace("/mfa");
          return "done";
        }
        flow.clear();
        const session = await refresh();
        router.replace(session.status === "signed-in" && session.me.user.onboarded ? "/" : "/handle");
        return "done";
      } catch (err) {
        setError(errorMessage(err));
        return err instanceof ApiError && err.code === "challenge_expired" ? "expired" : "failed";
      }
    },
    [refresh],
  );

  // One controller owns the conditional request (1c design, section 9); it is created once, and everything its runs touch is stable across renders.
  const [scheduler] = useState(() =>
    createAutofillScheduler({
      start: (run) => void runAutofill(run),
      abort: abortPasskeyRequest,
      after: (callback, ms) => {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
      },
    }),
  );

  /** One conditional request: the options, the browser's autofill until a passkey is picked or the request is aborted, then the verification. */
  async function runAutofill(run: number): Promise<void> {
    let options;
    try {
      options = (await api("/api/auth/passkey/signin/options", { method: "POST", schema: PasskeyOptionsResponse })).options;
    } catch {
      // The person did nothing yet, so nothing is said; the schedule rests until the screen is focused again.
      scheduler.ended(run, "failed");
      return;
    }
    // The screen went away, or the button took over, while the options were fetched: no ceremony now.
    if (!scheduler.isCurrent(run)) return;
    let response: AuthenticationResponseJSON | null;
    try {
      response = await autofillPasskey(options);
    } catch {
      scheduler.ended(run, "failed");
      return;
    }
    // Aborted, in which case the schedule has moved on already, or closed without a choice: nothing to verify.
    if (response === null) {
      scheduler.ended(run, "failed");
      return;
    }
    scheduler.ended(run, await signIn(response));
  }

  // The conditional request lives while the screen is focused and the browser can show one; a screen that goes away aborts it, and unmounting ends it for good.
  useFocusEffect(
    useCallback(() => {
      if (!passkeys) return undefined;
      let away = false;
      void autofillSupported().then((supported) => {
        if (supported && !away) scheduler.focus();
      });
      return () => {
        away = true;
        scheduler.blur();
      };
    }, [passkeys, scheduler]),
  );
  useEffect(() => () => scheduler.dispose(), [scheduler]);

  /** The button's own request: the browser's prompt with every passkey it holds for korbat, then the same verification as the autofill's. */
  async function passkeyButton() {
    if (busy) return;
    setBusy(true);
    setError(null);
    // The conditional request steps aside for the prompt, which the library would otherwise abort itself.
    scheduler.hold();
    let outcome: Outcome = "failed";
    try {
      const { options } = await api("/api/auth/passkey/signin/options", { method: "POST", schema: PasskeyOptionsResponse });
      const response = await confirmWithPasskey(options);
      if (response !== null) outcome = await signIn(response);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      // A signed-in screen is on its way out; anything else lets the autofill come back.
      if (outcome !== "done") scheduler.release();
    }
  }

  async function submit() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const address = email.trim();
      const { flowId } = await api("/api/auth/email/start", {
        json: { email: address, turnstileToken: token, deviceId: deviceId(), platform },
        schema: FlowResponse,
      });
      flow.set({ email: address, flowId, mfaTicket: undefined });
      router.push("/code");
    } catch (err) {
      setError(errorMessage(err));
      turnstile.current?.reset();
      setToken(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>korbat</Title>
      <Body>Enter your email. We'll send a code that signs you in, or creates your account if you don't have one yet.</Body>
      <Field label="Email" autoComplete={EMAIL_AUTOFILL} autoCapitalize="none" inputMode="email" value={email} onChangeText={setEmail} onSubmitEditing={submit} />
      {passkeys ? <Button label="Sign in with a passkey" onPress={() => void passkeyButton()} busy={busy} tone="secondary" /> : null}
      <View className="mt-6">
        <Turnstile
          ref={turnstile}
          siteKey={SITE_KEY}
          options={{ theme: "dark", refreshExpired: "manual" }}
          onSuccess={setToken}
          onExpire={() => {
            setToken(null);
            turnstile.current?.reset();
          }}
          onError={() => setError("We could not verify that you are human. Reload the page and try again.")}
        />
      </View>
      <ErrorText message={error} />
      <Button label="Continue" onPress={submit} busy={busy} disabled={!email.includes("@") || token === null} />
      <TextLink label="Sign in with a password instead" href="/password" />
      <TextLink label="Read the terms" href="/terms" />
      <TextLink label="Back to the latest posts" href="/" replace />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/email-revert/[token].tsx` (whole file)

```tsx
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Body, Button, ErrorText, Screen, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

/**
 * Opened from the link in the "email address changed" notice, which goes to the address the account
 * had. The link is the only credential needed, because an account without a password can no longer
 * sign in at that address. Nothing happens until the person confirms.
 */
export default function EmailRevert() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/email/revert", { json: { token } });
      setDone(true);
      // This browser's own session, if it had one, was signed out with the others.
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Title>Your account is back at this address</Title>
        <Body>
          Every session is signed out, including any in this browser. Sign in again with a code sent to this address. Your password was removed, and so were any passkeys and
          two-factor authentication set up in the day before the change; set them up again from Security.
        </Body>
        <Button label="Sign in" onPress={() => router.replace("/signin")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Undo the email change</Title>
      <Body>
        If you did not move your korbat account to a new email address, confirm below. We will move it back to the address this link was sent to, sign out every session,
        including this browser, remove your password, and remove any passkeys and two-factor authentication set up in the day before the change.
      </Body>
      <ErrorText message={valid ? error : "This link is incomplete. Open it again from the email."} />
      <Button label="Move my account back to this address" onPress={() => void confirm()} busy={busy} disabled={!valid} tone="danger" />
      <TextLink label="It was me, go back" href="/" replace />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/index.tsx` (whole file)

```tsx
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { Redirect, router } from "expo-router";
import type { MeResponse } from "@korbat/contracts";
import { AppShell } from "@/components/AppShell";
import { ComposeButton, ComposeSheet } from "@/components/social/ComposeSheet";
import { Composer } from "@/components/social/Composer";
import { TimelineList } from "@/components/social/PagedList";
import { Button, Loading } from "@/components/ui";
import { dismissSuggestion, platformPasskeyAvailable, suggestionDismissedAt, suggestPasskey } from "@/lib/passkeys";
import { useSession } from "@/lib/session";
import { social } from "@/lib/social";

type Tab = "following" | "latest";

/**
 * The nudge towards a passkey (1c design, section 9): for an account without one, on a device with a built-in
 * authenticator to add one with, until Not now, which holds for 30 days on this device.
 */
function PasskeySuggestion({ me }: { me: MeResponse }) {
  const [platform, setPlatform] = useState(false);
  const [dismissedAt, setDismissedAt] = useState(suggestionDismissedAt);
  useEffect(() => {
    let cancelled = false;
    void platformPasskeyAvailable().then((available) => {
      if (!cancelled) setPlatform(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!suggestPasskey({ passkeys: me.user.passkeys, platformAuthenticator: platform, dismissedAt, now: Date.now() })) return null;
  return (
    <View className="mx-4 mt-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <Text accessibilityRole="header" aria-level={2} className="text-base font-semibold text-zinc-50">
        Sign in faster with a passkey
      </Text>
      <Text className="mt-1 text-sm text-zinc-300">A passkey signs you in with your fingerprint, face or PIN, and cannot be phished. Adding one takes a moment.</Text>
      <View className="mt-3 flex-row gap-2">
        <Pressable accessibilityRole="button" onPress={() => router.push("/settings/security?add=1")} className="rounded-lg bg-zinc-50 px-4 py-2">
          <Text className="text-sm font-semibold text-zinc-950">Add a passkey</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            const now = Date.now();
            dismissSuggestion(now);
            setDismissedAt(now);
          }}
          className="rounded-lg border border-zinc-700 px-4 py-2"
        >
          <Text className="text-sm text-zinc-200">Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Home: Following and Latest for a signed-in account, Latest with a sign-in prompt for everyone else. */
export default function Home() {
  const { state } = useSession();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>("following");
  const [version, setVersion] = useState(0);
  const [composing, setComposing] = useState(false);
  const fetchFollowing = useCallback((cursor?: string) => social.following(cursor), []);
  const fetchLatest = useCallback((cursor?: string) => social.latest(cursor), []);

  if (state.status === "loading") {
    return (
      <AppShell>
        <Loading />
      </AppShell>
    );
  }
  if (state.status === "signed-in" && !state.me.user.onboarded) return <Redirect href="/handle" />;

  const signedIn = state.status === "signed-in";
  const current: Tab = signedIn ? tab : "latest";
  const inlineComposer = signedIn && width >= 768;
  const posted = () => setVersion((v) => v + 1);

  return (
    <AppShell floating={signedIn && !inlineComposer ? <ComposeButton onPress={() => setComposing(true)} /> : undefined}>
      <View className="border-b border-zinc-800 px-4 pt-4">
        <Text accessibilityRole="header" className="text-xl font-bold text-zinc-50">
          Home
        </Text>
        {signedIn ? (
          <View accessibilityRole="tablist" className="mt-3 flex-row">
            {(["following", "latest"] as Tab[]).map((t) => (
              <Pressable key={t} accessibilityRole="tab" aria-selected={current === t} onPress={() => setTab(t)} className={`mr-6 border-b-2 pb-2 ${current === t ? "border-zinc-50" : "border-transparent"}`}>
                <Text className={`text-base ${current === t ? "font-semibold text-zinc-50" : "text-zinc-400"}`}>{t === "following" ? "Following" : "Latest"}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View className="my-3 rounded-lg bg-zinc-900 px-4 py-3">
            <Text className="text-sm text-zinc-300">You are reading the latest public posts. Sign in to follow people and post.</Text>
            <Button label="Sign in" onPress={() => router.push("/signin")} tone="secondary" />
          </View>
        )}
      </View>
      {state.status === "signed-in" ? <PasskeySuggestion me={state.me} /> : null}
      {inlineComposer ? (
        <View className="border-b border-zinc-800">
          <Composer onPosted={posted} />
        </View>
      ) : null}
      <TimelineList
        key={`${current}:${version}`}
        fetchPage={current === "following" ? fetchFollowing : fetchLatest}
        empty={current === "following" ? "Nothing here yet. Follow someone, or switch to Latest." : "No posts yet."}
      />
      <ComposeSheet open={composing} onClose={() => setComposing(false)} onPosted={posted} />
    </AppShell>
  );
}
```

### Replace `apps/app/src/app/not-me/[token].tsx` (whole file)

```tsx
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Body, Button, ErrorText, Screen, TextLink, Title } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

/** Opened from the new-device email. Nothing happens until the person confirms. */
export default function NotMe() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/not-me", { json: { token } });
      setDone(true);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Title>Your account is locked down</Title>
        <Body>
          Every session is signed out, your password is removed, and any passkeys and two-factor authentication set up in the day before that sign-in are removed. Sign in again
          with a code sent to your email, then set a new password and turn on two-factor authentication.
        </Body>
        <Button label="Sign in" onPress={() => router.replace("/signin")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>This wasn't me</Title>
      <Body>
        If you didn't just sign in to korbat on a new device, confirm below. We'll sign out every session, including this browser, remove your password, and remove any passkeys
        and two-factor authentication set up in the day before that sign-in, so only someone with your email can get back in.
      </Body>
      <ErrorText message={valid ? error : "This link is incomplete. Open it again from the email."} />
      <Button label="Sign out everywhere and lock down my account" onPress={() => void confirm()} busy={busy} disabled={!valid} tone="danger" />
      <TextLink label="It was me, go back" href="/" replace />
    </Screen>
  );
}
```

### Replace `apps/app/src/app/settings/security.tsx` (whole file)

```tsx
import { ScrollView, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AppShell } from "@/components/AppShell";
import { MfaSection } from "@/components/security/MfaSection";
import { PasskeysSection } from "@/components/security/PasskeysSection";
import { PasswordSection } from "@/components/security/PasswordSection";
import { ReauthPanel, useReauth } from "@/components/security/ReauthPanel";
import { SessionsSection } from "@/components/security/SessionsSection";
import { SettingsNav } from "@/components/SettingsNav";
import { Button, Loading, Section } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function SecuritySettings() {
  const { state, refresh } = useSession();
  // reenroll=1 after a recovery code was used; add=1 from the home screen's passkey card, which opens the Add dialog at once.
  const { reenroll, add } = useLocalSearchParams<{ reenroll?: string; add?: string }>();
  const reauth = useReauth();

  if (state.status !== "signed-in") return <Loading />;
  const { me } = state;

  async function signOut() {
    await api("/api/auth/signout", { method: "POST" }).catch(() => undefined);
    await refresh();
    router.replace("/");
  }

  return (
    <AppShell>
      <ScrollView className="flex-1 bg-zinc-950" contentContainerClassName="px-4 py-6">
        <Text accessibilityRole="header" className="text-3xl font-bold tracking-tight text-zinc-50">
          Security
        </Text>
        <Text className="mt-2 text-base text-zinc-400">
          @{me.profile?.handle} · {me.user.email}
        </Text>
        <SettingsNav current="security" />

        {reauth.pending ? <ReauthPanel me={me} pending={reauth.pending} onClose={reauth.clear} /> : null}

        <Section title="Two-factor authentication">
          <MfaSection me={me} run={reauth.run} refresh={refresh} reenroll={reenroll === "1"} />
        </Section>
        <Section title="Password">
          <PasswordSection me={me} run={reauth.run} refresh={refresh} />
        </Section>
        <Section title="Passkeys">
          <PasskeysSection me={me} run={reauth.run} refresh={refresh} openAdd={add === "1"} />
        </Section>
        <Section title="Where you're signed in">
          <SessionsSection run={reauth.run} refresh={refresh} />
        </Section>

        <Button label="Sign out" onPress={() => void signOut()} tone="secondary" />
      </ScrollView>
    </AppShell>
  );
}
```

### Replace `apps/app/src/components/security/MfaSection.tsx` (whole file)

```tsx
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
              clipboard
                .writeText(stage.recoveryCodes.join("\n"))
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
        <Body>Two-factor authentication will be turned off, and your recovery codes stop working. You will be asked to confirm it's you first.</Body>
        <ErrorText message={error} />
        <Button label="Turn off two-factor" onPress={disable} busy={busy} tone="danger" />
        <Button label="Cancel" onPress={() => setStage({ kind: "idle" })} tone="secondary" />
      </View>
    );
  }

  return (
    <View>
      {reenroll && me.user.mfaEnabled ? (
        <Text className="mt-3 rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          You used a recovery code. Set up two-factor again to get a fresh set of codes.
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
```

### Replace `apps/app/src/components/security/ReauthPanel.tsx` (whole file)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { z } from "zod";
import { FlowResponse, PasskeyOptionsResponse, ReauthResponse, type MeResponse, type ReauthRequest } from "@korbat/contracts";
import { Body, Button, ErrorText, Field } from "@/components/ui";
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
  // What the last refusal said is needed; the action's own refusal after a first answer replaces it.
  const [needed, setNeeded] = useState(pending.needed);
  const { methods, missing } = methodsForLevel(needed, available);
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
      onClose();
      // A recovery code works once: two-factor should be set up again for a fresh set, as after a sign-in with one.
      if (result.mustReenrollMfa) router.replace("/settings/security?reenroll=1");
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
      <Button label="Cancel" onPress={onClose} tone="secondary" />
    </View>
  );
}
```

### Replace `apps/app/src/lib/api.ts` (whole file)

```ts
import { Platform } from "react-native";
import { ErrorEnvelope, HealthResponse, type AuthErrorCode } from "@korbat/contracts";
import type { z } from "zod";

/** Same origin on web (Caddy proxies /api). Native needs an absolute URL. */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "web" ? "" : "http://localhost:3000");

const CSRF_COOKIE = "__Host-korbat_csrf";
const DEVICE_KEY = "korbat.deviceId";

/** Browser globals, typed locally so this file does not depend on the DOM type library. */
const web = globalThis as unknown as {
  document?: { cookie: string };
  localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  crypto: { getRandomValues<T extends Uint8Array>(array: T): T };
};

let onUnauthenticated: (() => void) | null = null;

/**
 * Called when a request outside the sign-in flow answers 401: the session ended elsewhere (signed
 * out everywhere, revoked, expired). The session provider registers it to drop the signed-in state.
 */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

/** A failed API call with the server's error code and a message fit to show the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Seconds until the request may be repeated, from Retry-After: a rate limit or the handle cooldown. */
    readonly retryAfter?: number,
    /** What the server sent beside the code (1c design, section 7.1): for reauth_required the level and the factors held, for passkey_limit the bound and its wait. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const MESSAGES: Partial<Record<AuthErrorCode | "unauthenticated" | "invalid_request" | "not_found" | "internal" | "network", string>> = {
  invalid_code: "That code is not valid. Check the latest email or request a new code.",
  code_expired: "That code has expired. Request a new one.",
  too_many_attempts: "Too many attempts. Start again.",
  invalid_credentials: "Email or password is incorrect.",
  mfa_required: "Turn on two-factor authentication first.",
  invalid_mfa_code: "That authentication code is not valid.",
  reauth_required: "Confirm it's you to continue.",
  csrf_failed: "This request could not be verified. Reload the page and try again.",
  turnstile_failed: "We could not verify that you are human. Try again.",
  disposable_email: "Disposable email addresses cannot be used.",
  age_requirement: "You must be at least 16 to use korbat.",
  terms_required: "Accept the current terms to continue.",
  handle_taken: "That handle is taken.",
  handle_invalid: "Handles are 3 to 20 characters: lowercase letters, numbers and underscores.",
  handle_reserved: "That handle is reserved.",
  password_too_short: "Passwords need at least 12 characters.",
  password_too_long: "Passwords can have at most 128 characters.",
  password_breached: "That password appears in known data breaches. Choose a different one.",
  password_check_unavailable: "We could not check that password right now. Try again in a moment.",
  staff_mfa_required: "Staff accounts must keep two-factor authentication on.",
  onboarding_required: "Choose a handle to finish setting up your account.",
  mail_unavailable: "We could not send the email. Try again in a moment.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  handle_cooldown: "Handles can change once every 30 days.",
  email_in_use: "That email address already belongs to an account.",
  phone_in_use: "That phone number is already verified on another account.",
  badge_unavailable: "Verification is not available on this korbat.",
  verify_unavailable: "We could not reach the verification service. Try again in a moment.",
  // Passkeys (1c design, section 9). The cap's sentence; the daily bound's wait is worded by messageFor from the details.
  passkey_invalid: "That passkey did not work. Try again or use your email.",
  passkey_unsupported: "This passkey provider is not supported. Try another one.",
  passkey_limit: "You have 10 passkeys. Remove one to add another.",
  passkey_suspended: "This passkey was switched off because a copy of it may exist. Remove it and add a new one.",
  passkey_not_found: "That passkey is gone.",
  challenge_expired: "That took too long. Try again.",
  unauthenticated: "Sign in to continue.",
  invalid_request: "Some details are missing or invalid.",
  not_found: "That no longer exists.",
  internal: "Something went wrong on our side. Try again.",
  network: "Cannot reach korbat. Check your connection.",
};

/** The daily passkey bound as the API details it: 5 added in a day, and the seconds until the day has a slot again. */
function dailyPasskeyBound(details: unknown): number | null {
  const bound = details as { reason?: unknown; retryAfter?: unknown } | null;
  return bound && typeof bound === "object" && bound.reason === "daily" && typeof bound.retryAfter === "number" && bound.retryAfter > 0 ? bound.retryAfter : null;
}

/** The message for a code; `details` is what the server sent beside it, which turns the daily passkey bound into its wait in hours. */
export function messageFor(code: string, fallback?: string, details?: unknown): string {
  const wait = code === "passkey_limit" ? dailyPasskeyBound(details) : null;
  if (wait !== null) {
    const hours = Math.max(1, Math.ceil(wait / 3600));
    return `You added 5 passkeys today. You can add another in about ${hours === 1 ? "1 hour" : `${hours} hours`}.`;
  }
  return MESSAGES[code as keyof typeof MESSAGES] ?? fallback ?? "Something went wrong. Try again.";
}

/** The message to show for any thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

function readCookie(name: string): string | undefined {
  const cookies = web.document?.cookie;
  if (!cookies) return undefined;
  for (const part of cookies.split("; ")) {
    const separator = part.indexOf("=");
    if (part.slice(0, separator) === name) return decodeURIComponent(part.slice(separator + 1));
  }
  return undefined;
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 32 random bytes as unpadded base64url (43 characters). */
function randomDeviceId(): string {
  const bytes = web.crypto.getRandomValues(new Uint8Array(33));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += BASE64URL[(n >> 18) & 63]! + BASE64URL[(n >> 12) & 63]! + BASE64URL[(n >> 6) & 63]! + BASE64URL[n & 63]!;
  }
  return out.slice(0, 43);
}

/** A random id created once per browser. The server stores only a keyed hash of it. */
export function deviceId(): string {
  try {
    const existing = web.localStorage?.getItem(DEVICE_KEY);
    if (existing && /^[A-Za-z0-9_-]{22,64}$/.test(existing)) return existing;
    const created = randomDeviceId();
    web.localStorage?.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return randomDeviceId();
  }
}

export const platform: "web" | "ios" | "android" = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";

interface RequestOptions<T> {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  json?: unknown;
  /** A raw body sent as it is, with its declared type: how an image is uploaded. */
  raw?: { type: string; body: Blob };
  /** Schema for a JSON response body. Omit for 204 responses. */
  schema?: z.ZodType<T>;
}

/**
 * Calls the API with the session cookie and answers with the raw response, for a body that is not
 * JSON (the account export's ZIP). State-changing requests echo the CSRF cookie in X-CSRF-Token; the
 * session cookie itself is HttpOnly and never readable here. A failed call throws an ApiError.
 */
export async function apiResponse(path: string, options: Omit<RequestOptions<unknown>, "schema"> = {}): Promise<Response> {
  const method = options.method ?? (options.json === undefined && options.raw === undefined ? "GET" : "POST");
  const headers: Record<string, string> = {};
  if (options.json !== undefined) headers["content-type"] = "application/json";
  if (options.raw) headers["content-type"] = options.raw.type;
  if (method !== "GET") {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers["x-csrf-token"] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      body: options.raw ? options.raw.body : options.json === undefined ? undefined : JSON.stringify(options.json),
    });
  } catch {
    throw new ApiError(0, "network", messageFor("network"));
  }

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/") && path !== "/api/me") onUnauthenticated?.();
    const parsed = ErrorEnvelope.safeParse(await res.json().catch(() => null));
    const code = parsed.success ? parsed.data.error.code : "internal";
    const details = parsed.success ? parsed.data.error.details : undefined;
    // The server's message is written for people and can be more specific than the generic text for
    // its code ("Two-factor setup expired. Start again."). Only validation and internal errors use
    // the local wording, because their server messages are technical, and the passkey bounds do, so
    // the daily bound's wait is worded here from the details.
    const local = code === "invalid_request" || code === "internal" || code === "passkey_limit" || !parsed.success;
    // Retry-After is whole seconds: on a rate limit, and on the handle cooldown, where it says when the next change is allowed.
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, code, local ? messageFor(code, undefined, details) : parsed.data.error.message, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined, details);
  }
  return res;
}

/** Calls the API as `apiResponse` does and parses the JSON answer with `schema`; omit it for a 204 response. */
export async function api<T = void>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const res = await apiResponse(path, options);
  if (!options.schema) return undefined as T;
  return options.schema.parse(await res.json());
}

export async function fetchHealth(): Promise<HealthResponse> {
  return api("/api/health", { schema: HealthResponse });
}
```

### Replace `apps/app/src/lib/terms.ts` (whole file)

```ts
/**
 * The terms shown at sign-up. TERMS_VERSION must equal the API's TERMS_VERSION setting; change both
 * together whenever the text changes, so every account records which version it accepted.
 */
export const TERMS_VERSION = "draft-2026-09";

export const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: "Draft",
    body: "These terms are a draft for testing korbat before launch. They will be replaced by reviewed terms and a privacy policy before korbat opens to the public.",
  },
  {
    title: "Who can use korbat",
    body: "You must be at least 16 years old. You can use a pseudonym. One person may hold more than one account, but not to evade a suspension.",
  },
  {
    title: "What you can post",
    body: "You can post opinions, including unpopular ones. Content is removed only when it breaks a published rule: sexual content, child sexual abuse material, targeted hatred or harassment based on protected traits, doxxing, direct threats of violence, or spam, scams and impersonation. Every removal names the rule, and you can appeal it.",
  },
  {
    title: "Your account",
    body: "You are responsible for keeping access to your email address. Turn on two-factor authentication and store your recovery codes; korbat cannot restore an account without them.",
  },
  {
    title: "Your data",
    body: "korbat stores your email address for sign-in and security messages, and never shows it to other people. IP addresses are stored only as keyed hashes, and a device keeps its hash for 30 days after it was last seen. Your date of birth is checked once and never stored. Your browser keeps a random device id so korbat can tell a new device from a known one; it is shared by every account used in that browser and is stored on the server only as a keyed hash. At sign-in, Cloudflare Turnstile checks that you are not a bot; it sees your IP address and browser details for that check, under Cloudflare's privacy policy. If you ask for the Verified badge, your phone number is handed to the verification provider for one text message, and korbat keeps only a keyed hash of it. From the Account settings you can export your account's data as a ZIP archive and delete your account; deletion removes your posts, keeps your handle reserved and cannot be undone. If you add a passkey, korbat keeps its public key, a name, the dates it was added and last used, and the device that added it; nothing about your fingerprint or face leaves your device.",
  },
];
```

## Step 4: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`
- `ERR_PNPM`

Observed on the dry run:

```text
(no output)
```

## Step 5: verify: test

```bash
pnpm test
```

Expected output contains:

- `Tests  `

Must not contain:

- `failed`
- `ERR_PNPM`

Observed on the dry run:

```text
packages/rules test:       Tests  4 passed (4)
packages/contracts test:       Tests  89 passed (89)
packages/db test:       Tests  27 passed (27)
packages/media-protocol test:       Tests  21 passed (21)
apps/app test:       Tests  59 passed (59)
apps/worker test:       Tests  45 passed (45)
apps/api test:       Tests  414 passed | 240 skipped (654)
```

## Step 6: verify: export

```bash
(cd apps/app && EXPO_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npx expo export --platform web 2>&1 | tail -8)
```

Expected output contains:

- `Exported`

Must not contain:

- `Error`
- `error:`

Observed on the dry run:

```text
Exported: dist
```

## Step 7: verify: compose-config

```bash
docker compose --env-file infra/.env.example -f infra/compose.yml config -q && echo config-ok
```

Expected output contains:

- `config-ok`

Observed on the dry run:

```text
config-ok
```

## Step 8: verify: stack-down

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml down && echo down-ok
```

Expected output contains:

- `down-ok`

Observed on the dry run:

```text
down-ok
```

## Step 9: verify: build

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml build > .data/stack-build.log 2>&1; echo build-exit=$?; tail -3 .data/stack-build.log
```

Expected output contains:

- `build-exit=0`

Observed on the dry run:

```text
build-exit=0
```

## Step 10: verify: stack-up

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d --wait && echo up-ok
```

Expected output contains:

- `up-ok`

Observed on the dry run:

```text
up-ok
```

## Step 11: verify: test-database

```bash
node scripts/test-db.mjs -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `migrations applied`
- `test database ready: korbat_test`

Observed on the dry run:

```text
migrations applied
test database ready: korbat_test
```

## Step 12: verify: smoke

```bash
node scripts/smoke-auth-stack.mjs --base http://localhost:8080 --mailpit http://localhost:58025 --terms draft-2026-09 -- docker compose -f infra/compose.yml -f infra/compose.dev.yml
```

Expected output contains:

- `smoke test passed`

Observed on the dry run:

```text
smoke test passed
```

## Step 13: verify: stack-stop

```bash
docker compose -f infra/compose.yml -f infra/compose.dev.yml stop caddy api worker cloudflared 2>/dev/null; docker compose -f infra/compose.yml -f infra/compose.dev.yml ps --format '{{.Name}} {{.Status}}'
```

Expected output contains:

- `postgres-1 Up`

Observed on the dry run:

```text
korbat-postgres-1 Up 50 seconds (healthy)
```

## Step 14: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/app/src/app/(auth)/signin.tsx`
- `apps/app/src/app/email-revert/[token].tsx`
- `apps/app/src/app/index.tsx`
- `apps/app/src/app/not-me/[token].tsx`
- `apps/app/src/app/passkey-remove/[token].tsx`
- `apps/app/src/app/settings/security.tsx`
- `apps/app/src/components/security/MfaSection.tsx`
- `apps/app/src/components/security/PasskeysSection.tsx`
- `apps/app/src/components/security/ReauthPanel.tsx`
- `apps/app/src/lib/api.ts`
- `apps/app/src/lib/passkeys.ts`
- `apps/app/src/lib/terms.ts`
- `apps/app/test/passkeys.test.tsx`

## Step 15: commit

```bash
git add -A
git commit -q -m "feat(app): the web app's passkey screens: a passkey button and conditional-mediation autofill on sign-in (one request at a time, renewed after nine minutes or an expired challenge, aborted on blur and unmount); the Passkeys section of Security with the list's tags, rename, remove, 'This wasn't me' behind its explanation, and the add dialog with the name the password manager shows; the re-authentication panel's passkey and recovery-code methods and its level-2 choice from what the refusal says is missing; the home screen's suggestion card with a 30-day 'Not now'; the passkey-remove page and the lockdown texts on the not-me and email-undo pages; TOTP disable without a code; the terms' passkey sentence" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(app): the web app's passkey screens: a passkey button and conditional-mediation autofill on sign-in (one request at a time, renewed after nine minutes or an expired challenge, aborted on blur and unmount); the Passkeys section of Security with the list's tags, rename, remove, 'This wasn't me' behind its explanation, and the add dialog with the name the password manager shows; the re-authentication panel's passkey and recovery-code methods and its level-2 choice from what the refusal says is missing; the home screen's suggestion card with a 30-day 'Not now'; the passkey-remove page and the lockdown texts on the not-me and email-undo pages; TOTP disable without a code; the terms' passkey sentence`.

## Report format (mandatory)

```text
TASK 7 REPORT
Files written: <count, expected 13>
Failing-test step (the error line): <paste>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "export": <paste the expected lines as printed>
Verify "compose-config": <paste the expected lines as printed>
Verify "stack-down": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Verify "stack-up": <paste the expected lines as printed>
Verify "test-database": <paste the expected lines as printed>
Verify "smoke": <paste the expected lines as printed>
Verify "stack-stop": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
