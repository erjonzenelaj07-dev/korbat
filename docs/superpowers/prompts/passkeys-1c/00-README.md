# korbat passkeys (1c) — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-09-25 to 2026-09-27 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run found and settled these points before the prompts were written:

- **Installed with the floor in force.** `@simplewebauthn/server` 14.0.2 and `@simplewebauthn/browser` 14.0.0 are old enough, but `pnpm install --config.minimum-release-age=0` would pull `@peculiar/asn1-*` 2.9.5, which is younger than 7 days until 2026-09-27; installed normally, every `@peculiar/asn1-*` resolves to 2.9.4 and the lockfile-age check passes (25 new versions).
- **`bytea` needs a custom type** in drizzle's pg-core (`packages/db/src/schema/helpers.ts`); `users.webauthn_user_id` is unique through a partial index (`where webauthn_user_id is not null`). The passkeys table already had a unique index on `credential_id`.
- **The body cap bounds registrations.** Every JSON body is capped at 64 KiB (`JSON_BODY_LIMIT_BYTES`), so a registration's whole body, not only its `attestationObject`, stays under 64 KiB; the formats korbat accepts are far smaller.
- **Stricter RP ID guard.** Production also refuses subdomains of `localhost` and an `APP_ORIGIN` whose host is an IP address or `localhost`; outside production an explicit RP ID must still be a bare domain name, and it is lowercased.
- **The error envelope already carried an optional `details`**; the app's `ApiError` gains it in Task 7.
- **Drizzle's journal newline.** drizzle-kit writes `meta/_journal.json` without a trailing newline; the file keeps the newline it had, so the diff is only the new entry.
- **`generateRegistrationOptions` takes bytes.** In 14.0.2 a `challenge` given as a string is treated as text and encoded again, so the options would carry a different string from the one korbat issued; korbat passes the decoded 58 bytes, and a test checks `options.challenge` is exactly the issued string. `userID` takes bytes only (a string throws). The library writes `requireResidentKey` into the `authenticatorSelection` object it is given, so every call builds a new one.
- **The HTTP statuses of the new codes** (the design names none): `passkey_invalid` is 401 like `invalid_credentials` and `invalid_mfa_code`; `passkey_unsupported` and `challenge_expired` are 400 like `code_expired`. The app ignores 401s on `/api/auth/*` paths, so none of them signs anyone out.
- **Canonical challenges only.** Node's base64url decoder ignores the spare bits of the last character, so several strings would name the same 58 bytes and each could be spent once; only the canonical encoding is accepted. A challenge at or past its expiry is `challenge_expired` at the spend as well, so the store is never handed a TTL of zero or less.
- **The library compares counters before it verifies the signature** (`verifyAuthenticationResponse` in 14.0.2), so an unsigned response could pass for a clone; korbat hands it a stored counter of 0 and applies its own rule after the signature has checked.
- **The attestation format is read first.** An attestation object that is not a CBOR map with a text `fmt` and a map `attStmt` is `passkey_invalid`; `packed` with any `x5c`, even an empty list, is `passkey_unsupported`; the library never runs for a refused format (the tests wrap its verify functions in pass-through spies and spy on `fetch`). Transports keep known values only, each once, five at most.
- **One importer.** A test in `passkey-webauthn.test.ts` checks that `webauthn.ts` is the only source file importing `@simplewebauthn/server`.
- **The sign-in path never mailed on a recovery code.** The design's "mails the owner as the sign-in path does" assumed it did; both paths now send a new `recovery_code_used` template, best effort. On the sign-in path the event is appended after `signIn` returns, so it can record the device row's id from the issued session (the MFA ticket holds the app's client device identifier, whose keyed hash names the `auth.devices` row, and a first sign-in on a new device creates that row only inside `signIn`); the re-authentication path records `session.deviceId` the same way.
- **`ReauthNeeded` is a type alias**, not an interface, so it passes as an `AuthError`'s `details` (an interface is not assignable to a `Record<string, unknown>` index signature); `AuthError` gained a `details` argument that the auth routes' and the app's error handlers render.
- **`repo.setReauth` and `sessions.markReauth` are gone**, replaced by `repo.writeFactor(id, kind, at)` (a jsonb concatenation that also sets `reauth_at`) and `sessions.addFactor(sessionId, kind)`; tests make a session stale with `writeFactor(id, "email", tenMinutesAgo)` plus `kv.del("sess:<id>")`, the sign-up's email code being those sessions' only factor.
- **`sessions.rotate` re-reads the row** after the one conditional update (`where id = $old and revoked_at is null`) and answers `invalid_credentials` (401) when nothing was rotated, so a session revoked meanwhile gets no replacement; `createSession` writes `reauth_at` as the latest factor, and its `factors` and `passkeyId` stay optional so Task 1's schema test still creates bare rows.
- **`recentFactors` lists kinds in a fixed order** (`email`, `password`, `passkey`, `passkey_uv`, `totp`, `recovery`), so `details.have` does not depend on the jsonb's key order; `reauthNeeded(session, level, windowMs?)` is what both freshness middlewares call.
- **`passkeysRemoved` in the lockdown event is the array of removed passkey ids** (the design's count is its length); `repo.deletePasskeys(userId, { since, ids })` returns them, and the lockdown reads the user row after its writes to decide `totpCleared`.
- **The email undo's event is the lockdown's** (`email_change_reverted` with the lockdown's metadata and `reverted: true`); the revert state carries the changing session's `passkeyId`.
- **"session, onboarding" means `requireOnboarding`**: a session still choosing a handle may add a passkey (as it may set up TOTP); the HTTP test relies on it.
- **The daily bound reads the five latest `passkey_added` events within 24 hours by the database clock**, so the wait in the refusal (`details.retryAfter`, seconds until the oldest of the five is a day old) does not depend on the API's clock; the message says the wait in hours.
- **The limits count before the lookup**, so a rename, delete or 'not mine' on an unknown id spends the account's bucket; 'not mine' and the remove link send no mail (the lockdown's event records them).
- **`addPasskey` can find the account gone under the lock** (`AddPasskeyOutcome.gone`), answered as `invalid_credentials`; the default name is "Passkey on the web / iOS / Android" from the device row's platform.
- **The counter write, `last_used_at` and `backed_up` are not in the repository after Task 4**; Task 5 adds them with sign-in. Task 6 owes `takeDown` the passkey deletion and the `webauthn_user_id` clearing.
- **`ReauthRequest` moved** from `packages/contracts/src/auth.ts` to `packages/contracts/src/passkeys.ts`: its passkey variant needs `AuthenticationResponseJSON`, and `auth.ts` importing `passkeys.ts` would form an import cycle at evaluation time; `ReauthResponse` stays in `auth.ts`, and both are exported from `@korbat/contracts`.
- **`passkey_suspended` is 403** (a real credential refused by policy); `passkey_invalid` stays 401 and `challenge_expired` 400.
- **The new-device limit is two buckets** (`passkey-signin-new-device:hour:<userId>` 5 an hour and `:day:<userId>` 20 a day), counted after a verified signature and only when no device of the account matches the request's device.
- **The memory harness became a session store** (`createSession`, `findActiveSession`, `rotateSession`, `writeFactor`, the device methods, `claimTotpStep`, the passkey lookups and the counter write), so sign-in, the MFA step and re-authentication run in unit tests; a unit test with TOTP must store a real encrypted secret (the older `"v1:owner"` placeholder does not decrypt).
- **`ExportFormat.account.passkeys` is required** (an empty array when there are none), like `sessions`, `devices` and `events`; an archive written before 1c would no longer parse with the contract, which only tests do today. The format name stays `korbat-export-1` (the field is additive).
- **The take-down's two passkey statements are no-ops on a second run**, so `finishTakeDown` repeats them idempotently; the shared `takeDownRows` runs them before the event insert, and a take-down whose last statement fails leaves the passkey and the handle in place (both writes are in the transaction).
- **The web app has no bearer-session plumbing** (cookie sessions only), so nothing stores `ReauthResponse.token`; the answer is parsed so a token is accepted and the session refreshed, with a comment where a native client would keep it (sub-project 5).
- **The browser library's response types clash with the contracts'** (`clientExtensionResults` is a DOM type in the library and a record in the contracts), so `lib/passkeys.ts` parses every ceremony's result into the contract schemas before it reaches the API.
- **Autofill's scheduler resumes after the button's request ends without a sign-in**; autofill failures before a passkey is picked are silent and failures after a pick are shown; a browser refusal other than a cancel becomes `ApiError(0, "passkey_browser", ...)` with its own sentence.
- **The terms text changed without bumping `TERMS_VERSION`** (as 1b did): the API's accepted version would have to move with it, and Task 7 does not touch the API.
- **`{ passkey }` answers are parsed with a local schema** in the app, as the social module does for its own-profile answer; no contract type was added.
- **The sequential TOTP test passes on the old code too**, so the failing test is a concurrent one: both confirms read the pending secret before either spends it, and on the old code the loser fails 401 at the rotation after its writes. A confirm that finds a newer pending secret is refused and takes that secret with it; the owner starts the setup again.
- **The lockdown's transaction locks the user row first**, the order `takeDown` and `addPasskey` use, so they cannot deadlock; its tombstone write is best effort with a log line, as after a deletion. `repo.revokeDevices` and `repo.deletePasskeys` had no caller left and are removed.
- **The email undo's address restore stays outside the lockdown's transaction.** If the lockdown fails after the restore, the address is back, the link is spent and the `email-revert-open` marker stays for its day (a test pins this); deleting the marker earlier would let a still-live session's change mint a second undo link. An `email_in_use` refusal at the restore still spends the link.
- **`session_revoked` records `{ handle }`**, not the token's hash, and sign-out goes by handle; the app needed no change for the session id's new shape, since it validates the list with the contract.
- **The re-enrol hint uses the app's own sentence** ("Set up two-factor again to get a fresh set of codes.") on Security, Account and Profile, and a test pins that the three agree; `router.setParams` lands on the focused route, so after an action that navigates away itself the parameter lands where nothing reads it.
- **Ship the API and the web app together**: a cached web bundle with the older contract cannot parse the session list, whose ids changed shape.
- **Mutation checks of the gap tests**: each of eight mutations (the re-authentication lookup without the user clause, the factor read from the registration alone, the new-device limit before the signature, no daily bound, registration writing a factor, an unbound re-authentication challenge, options storing a challenge, the handle optional again) failed the test written for it and was reverted.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Run noise.** Timings and commit hashes differ on every run; every install prints `Packages: -N`, the optional packages pnpm skips on Windows.
- **Durations.** The integration suite runs its files one at a time and takes a few minutes; the web export runs a full Metro bundle and can take a few minutes.
- **The API prints two `ExperimentalWarning`s at start** (SimpleWebAuthn probes Node 24's ML-DSA support at import); they are expected.
- **The library import prints two `ExperimentalWarning`s** ("The supports Web Crypto API method" and "The ML-DSA-44 Web Crypto API algorithm"); expected on Node 24.

## Verified in the dry run only

These checks ran in the scratch clone only, because they need a browser or seed data the development database must not get:

- **The adversarial review of the API range (Tasks 1 to 6, `2c107ab..2e2334b`)**: five finders (webauthn-core, session-model, lockdown-and-links, registration-management, tests-and-gaps), each finding checked by three refuters with different lenses (code, tests, reachability), a finding surviving on two of three. 17 findings, 14 upheld and fixed in Task 8, 3 refuted: the rotation test's `passkey stays` claim (the one-column update keeps the column by construction), the counter write's lost race (the one conditional update decides it, as the TOTP step's does), and the sign-in method literals (correct at every call site, required by the type, and unobservable outside the database). The registration-management finder reported nothing. The web app (Task 7, read at `9ade43b`) was reviewed the same way by one finder: 4 findings, all upheld and fixed in Task 8 (the re-authentication panel's redirect after a recovery code, its re-enrol hint, its stale level after another refusal, and the lockdown's wording).
- **The ceremonies ran in a real browser.** The built-in browser pane has no authenticator, so `pw-walkthrough.mjs` in the scratch tooling drove Chromium 153 (Playwright 1.63.0, the build the machine already held) with a CDP virtual authenticator against the scratch stack on `http://localhost:8380`: registration, sign-in by passkey (a browser gets cookies, never the token), re-authentication at level 2 with the token rotated in place, replayed and cross-purpose challenges refused, the mailed remove link's lockdown, and the removed passkey refused afterwards; 40 checks, all passed, on the build of Task 7 and again on the final build of Task 8. The authenticator still holds the credential afterwards, since korbat never calls the Signal API.
- **The app's screens ran in the same browser.** `pw-screens.mjs` clicked through the web app with the virtual authenticator: the home screen's card, the add dialog (the handle prefilled as the password manager's name), the ceremony and the list's tags, the browser's refusal of a second passkey on the same authenticator with the dialog's sentence for it, rename, sign-in by autofill (a conditional request the authenticator answers without a picker) and by the button (which aborts a pending conditional request first), the re-authentication panel's passkey method on a session made stale in the scratch database, 'This wasn't me' behind its explanation, and the mailed remove link's page working once; 43 checks, all passed, on both builds, and no script error in the console.

## Before you start

- **Files are written by a script, never typed.** A file block can contain backslash escape sequences, and a writing tool can decode those into the characters they stand for; the 2b dry run's own tooling did exactly that once. These prompts were replayed into the repository by `replay.py` in the scratch tooling, which runs exactly these steps without a model session; a fresh session following them by hand must reach the same commits. Every writing step therefore runs `write_blocks.py`, which copies the step's blocks from the committed prompt file byte for byte, and `verify_prompts.py` checks the result after the last task.
- Every gate in the dry run ran with its standard input closed and a time limit. If a step sits without output for much longer than its allowed difference says, it is stuck, not slow: stop it and report.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-ground.md` | The ground for passkeys: SimpleWebAuthn 14.0.2 and the browser package 14.0.0 under the release-age floor, the passkey contracts and error codes, migration 0010 (the user handle, the passkey columns, the session handle, factors and passkey id, three event types), the WebAuthn configuration with its production guards, and three mail templates | **yes** |
| 2 | `02-passkey-core.md` | The passkey core: stateless HMAC-sealed challenges spent once through the key-value store, one wrapper around SimpleWebAuthn 14 with korbat's own checks (the attestation format, the pinned algorithms, the credential id length, the transports, the counter rule kept out of the library), and a software authenticator for the tests | **yes** |
| 3 | `03-session-factors-lockdown.md` | Session factors and the lockdown: the factors and the method recorded at every sign-in, freshness and the level read from them, strong freshness (level 2 on an account with TOTP) on the seven routes the design lists with the refusal naming the level and the factors held, in-place token rotation for every caller, re-authentication limits keyed by the session handle and the IP hash plus a recovery-code method, TOTP setup bound to the session handle and disable with an empty body, and the lockdown routine behind the new-device not-me link and the email-change undo | **yes** |
| 4 | `04-passkey-registration.md` | Passkey registration and management: register options behind strong freshness with the cap of 10 and the bound of 5 a day, register verify with the challenge read and spent before the library runs and one transaction that re-checks both bounds under the user row's lock, the passkey_added mail with a 7-day remove link, the list with its tags, rename and delete, 'not mine' and the remove link on the lockdown, and the passkey count in /api/me | **yes** |
| 5 | `05-passkey-signin.md` | Passkey sign-in and re-authentication: sign-in options without a session and verify with the challenge spent before the library runs, the user handle checked, the counter written in one conditional update (a regression suspends the passkey, records it, mails the owner and refuses), passkey_uv only for a user-verified assertion on a passkey that was registered with user verification, a new-device limit counted after the signature, the MFA ticket when the account has TOTP and the assertion lacked user verification; re-authentication options and the passkey method on Task 3's flow | **yes** |
| 6 | `06-deletion-export.md` | Deletion and export cover passkeys: the take-down deletes the account's passkeys and clears its WebAuthn user handle inside its transaction (the purge repeats both), and the export lists the passkeys (name, dates, synced, the adding device) with no key material or ids, byte-identical to the streamed document | **yes** |
| 7 | `07-web-app.md` | The web app's passkey screens: a passkey button and conditional-mediation autofill on sign-in, the Passkeys section of Security (list with tags, rename, remove, 'This wasn't me', the add dialog with the password-manager name), the re-authentication panel's passkey and recovery-code methods and its level-2 choice, the home screen's suggestion card, the passkey-remove page and the lockdown texts on the not-me and email-undo pages, TOTP disable without a code, and the terms' passkey sentence; the whole stack rebuilt and smoke-tested | **yes** |
| 8 | `08-review-fixes.md` | What the review of 1c upheld, fixed: links are checked before they are spent, the lockdown is one transaction, 'not mine' counts only lockdowns, sessions are listed and revoked by their handle, the pending TOTP secret is spent once, the session cache key is versioned, the user handle is required at sign-in, six test gaps are closed, and the web app keeps what a recovery-code re-authentication just showed, follows the refusal it answers and words the lockdown as it works; the whole stack rebuilt and smoke-tested | **yes** |
| 9 | `09-documentation.md` | The README's passkey section and its production setting, the email undo and the export described as 1c left them, 1c recorded in the 1a and 1b specs and the main design, and the 1c spec's dry-run amendments | no |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-09-25-passkeys-1c-design.md`, including its amendments from the dry run. The task map is `docs/superpowers/plans/2026-09-25-passkeys-1c.md`. Where the plan and a prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 9, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/passkeys-1c/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.

## Execution findings (2026-09-27)

The nine prompts were replayed into this repository by the scratch tooling's `replay.py`. It ran each prompt's steps with no model session, through the same gated runner as the dry run. Every red step failed as recorded, every gate passed, and both stack rebuilds, in Tasks 7 and 8, ended with the smoke test passing. The commits are:

| Task | Commit |
|---|---|
| 1 | `41ac97a` |
| 2 | `018131a` |
| 3 | `6435288` |
| 4 | `7239883` |
| 5 | `9ac20c3` |
| 6 | `9a26a7a` |
| 7 | `0be531e` |
| 8 | `cf8eee7` |
| 9 | `05cf442` |

- **Identical to the dry run, with two exceptions below.** Each commit changes the same paths as its dry-run commit, and every file of Tasks 2 to 9 is byte-identical. `verify_prompts.py` reproduces all 109 files.
- **The lockfile resolved a newer patch.** Task 1 installs under the 7-day release-age floor. On the dry run (2026-09-25) `@peculiar/asn1-*` 2.9.5 was younger than 7 days, so every one of them resolved to 2.9.4; on the replay (2026-09-27) 2.9.5 had passed the floor and the lockfile holds it. No other entry of the lockfile differs, and the release-age check and every test passed with it.
- **Two drizzle files end with a newline.** `packages/db/migrations/0010_free_thunderbolt.sql` and `meta/0010_snapshot.json` end with a newline here and without one in the dry run, as in the 1b replay: drizzle-kit writes them without one, and `write_blocks.py` writes the prompt's block, which ends with one. drizzle reads both.
- **One retry, in Task 3.** The first attempt stopped before any gate ran: while the runner hid the implementation for the red step, Windows refused for a moment to reopen `apps/api/src/auth/flows/password.ts` (another process held it). The files were restored to Task 2's commit and the task was replayed from its first step. The runner now retries such a write for up to twenty seconds, and restores what it already hid if hiding fails.
- **The reviews that shaped Task 8.** After Task 6, an adversarial review read the API range with five reviewers, each finding checked by three refuters with different lenses (the code, the tests, whether a user can reach it). After Task 7 a sixth reviewer read the web app the same way. Of 21 findings, 18 were upheld and are fixed in Task 8; the 3 refuted ones are listed under the dry-run-only checks above.
- **The browser walk-throughs.** The ceremonies and the screens ran in Chromium with a virtual authenticator against the scratch stack, on the build of Task 7 and again on the final build of Task 8, and passed both times. They stay in the scratch tooling (`pw-walkthrough.mjs`, `pw-screens.mjs`), since they need seed accounts and a browser this repository's tests do not have.
