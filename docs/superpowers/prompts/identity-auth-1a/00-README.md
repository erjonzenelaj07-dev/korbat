# korbat 1a (accounts and sessions) — execution prompts

One file per task. Each file is a complete, self-contained prompt: paste the whole file into a fresh Claude Code session opened at `C:\Users\Lenovo\Desktop\cool\korbat` and let it run. Do them in order. Every prompt checks that the previous task's commit is the latest one before it starts.

## How these prompts were made reliable

Every task was dry-run end to end on 2026-09-14 in a scratch clone of this repository, one commit per task. For each task a runner wrote the tests, ran them and required the expected failure, and wrote the implementation. It then ran every verification command and required each expected line, refused any changed file outside the task's list, and only then committed. These prompts are generated from those commits and the recorded outputs. Every file block is the committed file, and every "Observed on the dry run" block is real output. The scratch clone used shifted ports and its own compose project; the prompts use this repository's real ports and commands.

The dry run found and fixed these defects before the prompts were written:

- **TOTP library.** The usual TypeScript TOTP library scope is marked unsupported on npm. TOTP and base32 are implemented on `node:crypto` instead, and the spec was amended.
- **Release-age floor.** pnpm re-checks the age of the whole lockfile on every add, so every dependency change failed while older locks were younger than 7 days. Dependencies are added with the check off for that one command, and `scripts/check-lockfile-age.mjs` proves nothing newly locked is too young.
- **Wrapped database errors.** Drizzle wraps Postgres errors, so permission checks read the error's `cause`.
- **Config at collection time.** Integration suites that loaded config while vitest collected them crashed the unit run, because skipped suites are still collected. Config now loads in `beforeAll`.
- **Health test.** The Foundation health integration test did not pass the new `auth` dependency and failed typecheck.
- **Bundle chunks.** Three tsup entries split the bundle into shared chunks, so the check that argon2 stays external looks at every file in `dist/`.
- **Guard and response shapes.** `requireSession` needed a 403 `onboarding_required`, and routes that rotate the session needed JSON bodies so native clients receive the new token. The spec was amended.
- **Split encryption keys.** The API in Docker and the API on the host generated different TOTP encryption keys, which would break enrolled authenticators when switching. The env generator now shares the keys.
- **GCM tag length.** Semgrep found that decryption of stored TOTP secrets did not pin the AES-GCM authentication tag length, which would let a forged ciphertext with a shorter tag pass. Task 4 now pins a 16-byte tag on both sides and tests that a 4-byte tag is refused; the dry run was repeated from Task 4.
- **QR code on web.** The browser check found that React Native Web's `Image` never drew the roughly 25 KB SVG data address of the TOTP QR code. The web app now renders it with a plain `<img>` (`QrCode.web.tsx`); native keeps React Native's `Image`.
- **Hidden server messages.** The web client replaced every server message with generic text for its code, so "Two-factor setup expired. Start again." read as "That authentication code is not valid." Server messages are now shown, except for validation and internal errors.
- **Route clash.** The Foundation home screen and `(auth)/index.tsx` both claimed `/`. The home screen is removed.

Each prompt replaces judgment with rules. Files are complete and copied byte for byte, commands run verbatim, and every expected line must appear. Any mismatch is a **STOP condition** that ends the session with a report instead of an improvised fix. The single permitted self-recovery is a clean `node_modules` reinstall after a `Cannot find module` error in a verification step.

## What can differ between runs

- **Transitive versions.** Transitive dependency versions resolved by the `pnpm add` commands in Tasks 5, 11 and 20 can differ. Direct dependencies are pinned exactly, and every new lock entry must still pass the 7-day check.
- **Task 5 blocked add.** On or after 2026-09-19 the deliberately blocked add can succeed. The prompt names this as an allowed difference.
- **Migration filename.** Drizzle's migration filename in Task 2 ends in two random words. The checks use a glob.
- **Timing tests.** The Task 18 timing tests depend on machine load. The prompt allows one repeat.
- **Build durations.** Docker image builds in Tasks 19 and 21 can take many minutes on the first run.
- **Run noise.** Timings, ids, hashes and commit hashes differ on every run.

## Order

| # | File | What it delivers | Needs Docker? |
|---|---|---|---|
| 1 | `01-auth-contracts.md` | Auth contracts in @korbat/contracts | no |
| 2 | `02-auth-schema.md` | Auth schema changes and migrations | **yes** |
| 3 | `03-auth-config.md` | Auth configuration, secrets and the dev env generator | **yes** |
| 4 | `04-auth-crypto.md` | Auth crypto helpers | no |
| 5 | `05-auth-dependencies.md` | 1a API dependencies and the lockfile age check | no |
| 6 | `06-auth-passwords.md` | Passwords: argon2id and the breached-password check | no |
| 7 | `07-auth-totp.md` | Base32, TOTP and recovery codes | no |
| 8 | `08-auth-policy.md` | Identifier hashes, handle rules, age check, device labels, disposable domains | no |
| 9 | `09-auth-cookies-turnstile.md` | Session cookies, CSRF, bearer tokens and Turnstile | no |
| 10 | `10-mailer.md` | Mailer, templates and Mailpit for development | **yes** |
| 11 | `11-auth-stores.md` | Key-value store and the auth repository | **yes** |
| 12 | `12-auth-sessions-lockout.md` | Sessions and password lockout | **yes** |
| 13 | `13-auth-flows-signup.md` | Email entry, sign-up, onboarding and sign-in flows | **yes** |
| 14 | `14-auth-flows-password-mfa.md` | Password and MFA flows | **yes** |
| 15 | `15-auth-flows-account.md` | Re-authentication, account, session management, 'not me' and role grants | **yes** |
| 16 | `16-auth-http.md` | Auth over HTTP: session resolution, CSRF, guards, routes and app wiring | **yes** |
| 17 | `17-auth-boundary-cli.md` | Auth module boundary test and the grant-role CLI | **yes** |
| 18 | `18-auth-e2e.md` | Auth end to end over HTTP against Postgres, Redis and Mailpit, with timing checks | **yes** |
| 19 | `19-auth-docker.md` | Auth in the Docker stack: argon2 beside the bundle, grant-role bundle, compose variables, Turnstile CSP, smoke test | **yes** |
| 20 | `20-web-auth.md` | Web auth screens: email entry with Turnstile, code, age and terms, handle, password, MFA, security settings, terms, 'this wasn't me' | no |
| 21 | `21-web-image-ci-docs.md` | Turnstile site key in the web image, CI lockfile-age and web export checks, dev env for the app, README | **yes** |

## Reading a report

Every session ends with a `TASK N REPORT` block. Check three lines before starting the next prompt:

1. `STOP condition hit: none`. If not, the session stopped on purpose. Read the pasted output, fix the environment (Docker not running, a port in use, data services down), and re-run the same prompt from a clean `git status`.
2. Every `Verify` line shows the expected text from the prompt.
3. The `Commit` line ends with the commit subject printed in the prompt.

If a report shows a STOP that is not an environment problem, paste the report back to the planning session. Do not let the executing session improvise.

The design is `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`, including its amendments from the dry run. The task map is `docs/superpowers/plans/2026-09-14-identity-auth-1a.md`. Where the plan and a prompt differ, the prompt is the verified version.

## Verify the prompts against the repository

After Task 21, run this from the repo root. It extracts the last version of every file the prompts write and compares it with the file on disk:

```bash
python docs/superpowers/prompts/identity-auth-1a/verify_prompts.py
```

Expected: `prompts reproduce the repository exactly`.
