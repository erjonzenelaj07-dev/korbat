# korbat audit fixes — Task 9 of 11: The 1a, 2a and 2b specs record the audit's amendments, the main design records the audit, the technologies, the method and the roadmap, and the audit spec records what its dry run settled

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-23 and 2026-09-24 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

korbat is a pseudonymous social platform with a fully self-owned backend. This task records what the audit batch changed: the amendments to the earlier design documents (fresh authentication for two-factor enrolment in 1a, blocks retracting reposts and likes in 2a, the retention job that 1a had left out of scope), the audit design's own amendments from the dry run, and the roadmap in the main design. The design is `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`, section 9.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(infra): PostgreSQL 18 on a new volume with an upgrade script for the old one; Valkey with a required password; Caddy runs as its own user on 8080, keeps the API's headers, caches the page and the bundles by kind, caps bodies and drops a client's CF-Connecting-IP unless the tunnel is in front; cloudflared, Caddy, the API and the data services on separate networks; memory, process and log limits on every service; images pinned by digest and pnpm installed by corepack from its hash; CI reads only, builds the images and pins semgrep; the dev scripts refuse a remote Docker; the browser rule counts Origin, Sec-Fetch-Site and Sec-Fetch-Dest, not the bare Sec-Fetch-Mode that Node's fetch sends`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the files

```bash
python docs/superpowers/prompts/audit-fixes/write_blocks.py docs/superpowers/prompts/audit-fixes/09-documentation.md 1
```

Expected: 5 lines starting with `wrote`, one for each file below.

### Replace `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md` (whole file)

````markdown
# korbat — Sub-project 1a: Core accounts and sessions — Design Spec

Parent design: `docs/superpowers/specs/2026-09-03-korbat-design.md` (section 3a, build-order row 1). Foundation (sub-project 0) is built; this sub-project replaces the session stub in `apps/api/src/middleware/session.ts`.

## Context

korbat's users post unpopular opinions under pseudonyms, which makes their accounts targets. Account takeover is the first threat in the parent design. 1a delivers everything a person needs to create an account, sign in safely, protect it with a second factor, see and revoke their sessions, and recover from a lost device, with no third-party auth vendor.

Sub-project 1 is split in three so each plan stays reliable:

| Part | Delivers | Depends on |
|---|---|---|
| **1a** (this spec) | Sign-up, sign-in, sessions, devices, MFA, re-authentication, recovery, staff MFA enforcement, mailer, auth screens | Foundation |
| **1b** | Profile editing and handle-change rules, verified badge, data export, account deletion | 1a, and 2 for export and deletion of content |
| **1c** | Passkeys (WebAuthn) as the promoted sign-in | 1a |

## Decisions

| Decision | Choice |
|---|---|
| Sign-in | Email code by default; a password is optional |
| Minimum age | 16. Date of birth is checked at sign-up and never stored |
| Registration | Open, with bot friction (Turnstile, disposable-email block, rate limits) |
| MFA | TOTP, optional and strongly prompted for users; required for moderators and admins |
| Lost email + MFA device + recovery codes | Not recoverable. No manual or support-desk recovery |
| Outbound email | Transactional relay behind a `Mailer` interface; EU-based provider (Brevo or Mailjet) in production; Mailpit in development |
| Auth code isolation | Module inside the API, boundary enforced by an architecture test |
| Password hashing | argon2id via `@node-rs/argon2` (native) |
| TOTP | RFC 4226/6238 implemented on `node:crypto` HMAC-SHA1 and proven against the published RFC test vectors. `@oslojs/otp` was chosen first, but on 2026-09-14 npm marked almost the whole `@oslojs` scope "no longer supported", so no third-party OTP or encoding library is used |

## 1. Scope

**In 1a**
- One email entry point for sign-up and sign-in, with email codes.
- Age check (16+), terms acceptance, handle and display name at onboarding.
- Optional password: set, change, sign in with it; breached-password check.
- TOTP MFA: setup with QR code, challenge, disable, 10 recovery codes, regenerate codes.
- Sessions: web cookie with CSRF protection, native bearer token, list, revoke one, sign out, sign out everywhere.
- Devices and new-device alert email with a "This wasn't me" link.
- Re-authentication for sensitive actions.
- Lockout and rate limits on every auth endpoint.
- Staff role granted by a server-side CLI; staff endpoints require MFA.
- Mailer interface, SMTP adapter, Mailpit in development.
- Web screens for all of the above, functional and in the current dark style.

**Not in 1a**
- Profile editing, handle changes after onboarding, verified badge, data export, account deletion (1b).
- Passkeys (1c).
- SMS for anything, ever.
- OAuth / social login.
- The 30-day IP-hash purge job (sub-project 4, with the column grant it needs).
- Final legal terms text (sub-project 4). 1a ships a draft terms page, clearly labelled as a draft, that summarises the public rulebook. Terms carry a version (`TERMS_VERSION`), recorded at sign-up; the re-acceptance flow for a new version is built with the final terms in sub-project 4.

## 2. Architecture

### 2.1 Auth module

All auth code lives in `apps/api/src/auth/`. Only `apps/api/src/auth/index.ts` may be imported from outside the folder. It exports:

- `createAuth(deps)` returning:
  - `routes`: a Hono sub-app mounted at `/api/auth`.
  - `resolveSession`: middleware that sets `c.var.session` from the bearer header or the session cookie, or `null`.
  - `requireSession`: 401 unless a session exists and the account is onboarded.
  - `requireOnboarding`: allows a session whose account is not yet onboarded (used only by onboarding routes).
  - `requireFreshAuth(maxAgeSeconds)`: 403 `reauth_required` unless `reauthAt` is within the window.
  - `requireStaffMfa`: 403 unless role is moderator or admin and MFA is enabled.
- `grantRole(deps, email, role)`: used only by the staff-role CLI (5.7).
- `type Session`, `type ProfileStore`.

Internal files, one responsibility each:

| File | Responsibility |
|---|---|
| `crypto.ts` | Random tokens, SHA-256, HMAC-SHA256, constant-time compare, AES-256-GCM encrypt/decrypt with versioned keys |
| `passwords.ts` | argon2id hash/verify, dummy-hash verify for unknown accounts, breached-password check |
| `codes.ts` | Generate, store (keyed hash), verify email codes bound to a flow |
| `base32.ts` | RFC 4648 base32 for TOTP secrets and recovery codes |
| `totp.ts` | HOTP/TOTP on `node:crypto`, secret generation, `otpauth` URI, QR code, verification with ±1 step and replay protection |
| `recovery-codes.ts` | Generate 10 codes, hash, consume |
| `sessions.ts` | Issue, resolve (with Redis cache), slide, rotate, revoke, list |
| `devices.ts` | Device hash, label from User-Agent, new-device detection |
| `lockout.ts` | Failure counting and account lock |
| `turnstile.ts` | Server-side Turnstile verification |
| `disposable.ts` + `data/disposable-domains.txt` | Disposable-domain check |
| `handles.ts` | Handle validation and reserved list |
| `csrf.ts` | CSRF cookie issue and double-submit + Origin check |
| `events.ts` | Append auth events |
| `repo.ts` | Every SQL statement against the `korbat_auth` pool |
| `flows/email.ts`, `flows/signup.ts`, `flows/password.ts`, `flows/mfa.ts`, `flows/reauth.ts`, `flows/sessions.ts`, `flows/not-me.ts` | One flow each |
| `routes.ts` | HTTP layer: validation with contracts, calls flows, sets cookies |

The API process wires `createAuth` in `apps/api/src/index.ts` with the auth pool, Redis, the mailer, config, the logger, and a `ProfileStore`. The auth module never receives the API pool: onboarding calls `profiles.create({ id, handle, displayName })` on the `ProfileStore` interface, implemented in `apps/api/src/profiles/store.ts` with the `korbat_api` pool, which returns `handle_taken` on a unique-index conflict. `sessionStub` is deleted. `apps/api/src/env.ts` imports the `Session` type from the auth module.

### 2.2 Boundary enforcement

`apps/api/test/architecture.test.ts` walks every `.ts` file under `apps/api/src` and fails when:
- a file outside `src/auth/` imports any path inside `src/auth/` other than `src/auth/index.ts`;
- a file references `DATABASE_URL_AUTH` or the identifier `authDb`, unless it is `src/config.ts` (declares the variable), `src/index.ts` or `src/cli/grant-role.ts` (create the pool and pass it to the module), or inside `src/auth/`;
- a file references `TOTP_ENC_KEY`, `AUTH_HMAC_KEY` or `IP_HASH_KEY`, unless it is `src/config.ts` or inside `src/auth/`;
- a file inside `src/auth/` imports public-schema tables from `@korbat/db` (the module works only with the `auth` schema).

No new dependency; it parses import statements with a regular expression and reads files with `node:fs`.

### 2.3 Mailer

`apps/api/src/mail/`:
- `mailer.ts`: `interface Mailer { send(message: { to: string; template: TemplateName; data: Record<string, string> }): Promise<void> }`.
- `smtp.ts`: `nodemailer` SMTP adapter configured from `SMTP_URL`.
- `templates.ts`: plain-text plus minimal HTML for `sign_in_code`, `sign_up_code`, `reauth_code`, `new_device`, `account_locked`. No images, no tracking pixels, no link tracking. Messages contain codes and korbat links only, never post content.
- `memory.ts`: in-memory mailer for unit tests.

Development: a `mailpit` service (`axllent/mailpit:v1.31.1`) is added to `infra/compose.dev.yml`, SMTP on `127.0.0.1:51025`, web UI on `127.0.0.1:58025`. Production: `SMTP_URL` points at the chosen EU relay; switching provider is a config change.

### 2.4 Contracts

`packages/contracts/src/auth.ts` holds every request and response schema for `/api/auth/*` and `/api/me`, plus the `AuthErrorCode` enum. `email` appears only in the `/api/me` response.

## 3. Data model changes

One migration, `0002_auth_core`, generated from the Drizzle schema plus a custom grants migration. All changes are additive.

**`auth.users`** gains:

| Column | Type | Purpose |
|---|---|---|
| `role` | enum `auth.user_role` (`user`, `moderator`, `admin`), default `user` | Staff authorisation |
| `age_confirmed_at` | timestamptz | When the 16+ check passed |
| `terms_version` | text | Accepted terms version |
| `terms_accepted_at` | timestamptz | When accepted |
| `onboarded_at` | timestamptz | Set when the profile row exists |
| `password_changed_at` | timestamptz | For alerts and session rotation |
| `totp_last_step` | bigint | Last accepted TOTP time step (replay protection) |

**`auth.email_codes`** gains `flow_id` (text, not null, unique) and `ip_hash` (text). The enum `auth.email_code_purpose` gains the value `reauth`.

**New `auth.auth_events`** (append-only):

| Column | Type |
|---|---|
| `id` | bigserial primary key |
| `user_id` | uuid, references `auth.users`, on delete set null |
| `type` | enum `auth.auth_event_type`: `signup`, `signin_success`, `signin_failure`, `mfa_enabled`, `mfa_disabled`, `recovery_code_used`, `recovery_codes_regenerated`, `password_set`, `password_changed`, `session_revoked`, `sessions_revoked_all`, `account_locked`, `new_device`, `not_me` |
| `device_id` | uuid, nullable |
| `ip_hash` | text, nullable |
| `metadata` | jsonb, default `{}` |
| `created_at` | timestamptz, default now |

RLS enabled with insert and select policies for `korbat_auth`. Grants: `korbat_auth` gets INSERT and SELECT only; UPDATE, DELETE and TRUNCATE are revoked. The column-level UPDATE on `ip_hash` needed by the purge job is granted in sub-project 4 together with that job. `korbat_api` has no access.

**Not stored anywhere:** date of birth, raw IP addresses, raw device ids, raw session tokens, raw email codes, raw recovery codes, unencrypted TOTP secrets.

**Redis keys** (all with TTL):

| Key | TTL | Content |
|---|---|---|
| `sess:<sessionHash>` | 60 s | Resolved session |
| `mfa-ticket:<hash>` | 5 min | Pending MFA sign-in (user, device, attempts) |
| `totp-pending:<userId>` | 10 min | Encrypted unconfirmed TOTP secret |
| `age-block:<emailHmac>` | 24 h | Sign-up blocked after an under-16 date of birth |
| `not-me:<tokenHash>` | 24 h | Single-use "This wasn't me" token |
| `pw-fail:<userId>` | 15 min from first failure | Password failure count for the lockout window |
| `rl:*` | window | Rate-limit counters (existing store) |

**Handles** are written to `public.profiles` through the `korbat_api` pool at onboarding. Rules: 3 to 20 characters from `a-z`, `0-9`, `_`; compared case-insensitively (existing unique index on `lower(handle)`); reserved list includes `admin`, `administrator`, `korbat`, `support`, `help`, `moderator`, `mod`, `staff`, `security`, `root`, `system`, `official`, `api`, `www`, `about`, `rules`, `transparency`, `settings`. Display name: 1 to 50 characters, trimmed, no control characters.

## 4. Sessions and transport

- **Token**: `kb1_` + base64url of 32 random bytes. `auth.sessions.id` stores its SHA-256 hex. The raw token exists only in the client.
- **Web**: cookie `__Host-korbat_session`, `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`. Chrome, Edge and Firefox accept `Secure` cookies on `http://localhost`, so development uses the same cookie; Safari does not and is not supported for local development.
- **CSRF**: cookie `__Host-korbat_csrf` (32 random bytes, not HttpOnly) issued with every session. Every non-GET request authenticated by cookie must send header `X-CSRF-Token` equal to the cookie (constant-time compare) and an `Origin` header equal to `APP_ORIGIN` or listed in `TRUSTED_ORIGINS`. Otherwise 403 `csrf_failed`.
- **Native**: `Authorization: Bearer kb1_...`. When this header is present, cookies are ignored and CSRF does not apply.
- **Lifetime**: `expires_at` is 30 days after last use, extended at most once per hour. `absolute_expires_at` is 12 months after creation and never extended.
- **Cache**: resolved sessions are cached in Redis for 60 seconds. Revocation deletes the cache key in the same operation.
- **Rotation**: a new session is issued, and the previous one revoked, on sign-in, MFA completion, MFA enable, password set or change, and recovery-code use.
- **Pending MFA**: when MFA is enabled, a successful first factor returns an MFA ticket (5 minutes, 5 attempts), never a session.
- **Onboarding scope**: an account without `onboarded_at` gets a session that only `requireOnboarding` routes accept.
- **Re-authentication**: `reauth_at` on the session. Password set or change, MFA disable, recovery-code regeneration and sign-out-everywhere require it within 5 minutes. Re-authenticate with the password, a TOTP code, or an email code.
- **Devices**: the client creates a random device id once (localStorage on web, SecureStore on native) and sends it with sign-in requests together with `platform` (`web`, `ios` or `android`). The server stores `HMAC(AUTH_HMAC_KEY, deviceId)`. The label is derived from the User-Agent at coarse granularity, for example "Chrome on Windows".
- **IP addresses**: stored only as `HMAC(IP_HASH_KEY, ip)`. The 30-day purge job arrives in sub-project 4.
- **Fresh sign-in counts as re-authentication**: every newly issued session starts with `reauth_at = now`.

`Session` type returned by `resolveSession`:

```ts
interface Session {
  sessionId: string;   // sha256 of the token
  userId: string;
  deviceId: string;
  role: "user" | "moderator" | "admin";
  onboarded: boolean;
  mfaEnabled: boolean;
  reauthAt: Date;
}
```

## 5. Flows and endpoints

All request and response bodies are defined in `packages/contracts/src/auth.ts`.

### 5.1 Email entry (sign-up and sign-in)

1. `POST /api/auth/email/start` `{ email, turnstileToken, deviceId, platform }` → `{ flowId }`
   - Verifies Turnstile (`turnstile_failed`), rejects disposable domains (`disposable_email`), and returns 403 `age_requirement` if the `age-block` key for this email exists.
   - Always responds the same way whether or not the email has an account, after a minimum of 400 ms.
   - Sends `sign_in_code` to an existing account or `sign_up_code` to a new email.
2. `POST /api/auth/email/verify` `{ flowId, code }` →
   - existing account, no MFA: `{ result: "session" }` and a session;
   - existing account, MFA on: `{ result: "mfa_required", mfaTicket }`;
   - new email: `{ result: "signup_required" }` (the flow stays valid 10 minutes).
3. `POST /api/auth/signup/complete` `{ flowId, dateOfBirth, termsVersion }` → (`dateOfBirth` is `YYYY-MM-DD`; age is computed against today's date in UTC; `termsVersion` must equal `TERMS_VERSION`, otherwise 400 `terms_required`)
   - age under 16: 403 `age_requirement`, flow deleted, `age-block` set, nothing written to Postgres;
   - otherwise creates the user and device, records `signup`, returns an onboarding-scope session.
4. `POST /api/auth/onboarding/handle` `{ handle, displayName }` (requires onboarding session) → `{ profile }`; writes `public.profiles`, sets `onboarded_at`, rotates the session to full scope.

### 5.2 Password

- `POST /api/auth/password/signin` `{ email, password, turnstileToken, deviceId, platform }` → session or `{ result: "mfa_required", mfaTicket }`.
  - Unknown email or account without password: verify against a dummy argon2id hash, return `invalid_credentials`.
  - Each failure increments `pw-fail:<userId>` in Redis (15-minute window) and mirrors the count to `failed_logins`. The fifth failure in the window sets `locked_until` to now + 15 minutes, records `account_locked` and sends `account_locked`. A locked account returns `invalid_credentials` too, so the response reveals nothing.
  - The lock applies to password sign-in only. Email-code sign-in keeps working, so someone guessing passwords cannot lock the owner out.
  - Success resets the failure counter.
- `POST /api/auth/password/set` `{ password }` (fresh auth) → 204. 12 to 128 characters; breached-password check; records `password_set` or `password_changed`; rotates the session.
- argon2id parameters: memory 65536 KiB, iterations 3, parallelism 1, output 32 bytes. Parameters are read from the stored hash, so they can be raised later with rehash-on-login.
- Breached-password check: `GET https://api.pwnedpasswords.com/range/<first 5 SHA-1 hex>` with `Add-Padding: true`, 3-second timeout. Any network failure returns 503 `password_check_unavailable`; the password is not saved.

### 5.3 MFA

- `POST /api/auth/mfa/totp/setup` (session; fresh auth when MFA is already enabled, because confirming replaces the secret and the recovery codes) → `{ otpauthUri, qrSvg }`. 20-byte secret, SHA-1, 6 digits, 30-second period, issuer `korbat`, label is the handle. Secret stored encrypted in `totp-pending` for 10 minutes. QR rendered server-side as SVG with `uqr`.
- `POST /api/auth/mfa/totp/confirm` `{ code }` → `{ recoveryCodes }` shown once. Stores `totp_secret_enc` as `v1:<base64 iv|ciphertext|tag>`, sets `totp_enabled_at`, stores 10 recovery-code hashes, records `mfa_enabled`, rotates the session.
- `POST /api/auth/mfa/verify` `{ mfaTicket, code }` or `{ mfaTicket, recoveryCode }` → session.
  - TOTP accepted for steps −1, 0, +1; the accepted step must be greater than `totp_last_step`, which is then updated.
  - A recovery code is consumed on use and records `recovery_code_used`. MFA stays enabled and the remaining codes stay valid. The response is `{ result: "session", mustReenrollMfa: true }` (otherwise `false`); the web app opens MFA setup, where confirming a new secret replaces the old one and issues 10 new codes. The new session's `reauth_at` covers the setup step.
- `POST /api/auth/mfa/totp/disable` `{ code }` (fresh auth) → 204. Clears secret and recovery codes, records `mfa_disabled`. Refused for moderators and admins (`staff_mfa_required`).
- `POST /api/auth/mfa/recovery-codes/regenerate` (fresh auth, MFA on) → `{ recoveryCodes }`.
- Recovery codes: 10 codes, each 12 base32 characters shown as `xxxx-xxxx-xxxx`, stored as `HMAC(AUTH_HMAC_KEY, code)`.

### 5.4 Re-authentication

- `POST /api/auth/reauth` with one of `{ method: "password", password }`, `{ method: "totp", code }`, `{ method: "email", flowId, code }` → 204, sets `reauth_at`.
- `POST /api/auth/reauth/email/start` (session) → `{ flowId }`, sends `reauth_code`.

### 5.5 Sessions and devices

- `GET /api/auth/sessions` → list with device label, platform, created, last used, current flag.
- `DELETE /api/auth/sessions/:id` → 204, records `session_revoked`.
- `POST /api/auth/sessions/revoke-all` (fresh auth) → 204, revokes every session including the current one, records `sessions_revoked_all`.
- `POST /api/auth/signout` → 204, revokes the current session and clears cookies.
- `GET /api/me` (any session, including onboarding scope) → `{ user: { id, email, role, onboarded, mfaEnabled, hasPassword }, profile | null }`.

### 5.6 New device and "This wasn't me"

- The first successful sign-in from a device hash not seen for that user records `new_device` and sends `new_device` with a link to `/not-me/<token>` (32 random bytes, single use, 24 hours).
- `POST /api/auth/not-me` `{ token }` → 204. Revokes all sessions, clears `password_hash`, records `not_me`. The next sign-in must use an email code (and MFA if enabled).

### 5.7 Staff roles

- `apps/api/src/cli/grant-role.ts`, bundled to `dist/grant-role.js`, run on the server: `docker compose -f infra/compose.yml run --rm api node dist/grant-role.js <email> <user|moderator|admin>`.
- The CLI creates both pools. It calls `grantRole` from the auth module (auth pool), then writes an entry to `public.audit_log` (actor `00000000-0000-0000-0000-000000000000`, action `role_granted`) through the API pool.
- There is no API endpoint that changes roles.
- `requireStaffMfa` guards every moderator and admin route from sub-project 3 onward; 1a ships it with tests.

## 6. Abuse controls

| Endpoint | Limits |
|---|---|
| `email/start` | Turnstile; 3 per email per hour; 10 per IP per hour; 60 s resend cooldown per email; 400 ms minimum response time |
| `email/verify` | 5 attempts per flow; 30 per IP per hour |
| `signup/complete` | 10 per IP per hour |
| `onboarding/handle` | 10 per session per hour |
| `password/signin` | Turnstile; account lock after 5 failures in 15 min; 20 per IP per 15 min |
| `mfa/verify` | 5 attempts per ticket, then the ticket is void; 20 per IP per 15 min |
| `reauth` | 5 per session per 15 min |
| Other auth endpoints | Existing global limit |

- Rate-limit keys use `HMAC(IP_HASH_KEY, ip)` and `HMAC(AUTH_HMAC_KEY, lower(email))`, never raw values.
- Turnstile: server-side `siteverify` with the secret key and the token only; the user's IP is not sent. Development and CI use Cloudflare's documented test keys.
- Email codes: 6 digits, 10 minutes, stored as `HMAC(AUTH_HMAC_KEY, flowId + code)`.
- Disposable domains: vendored from the public-domain `disposable-email-domains` list with an `update:disposable` script.

## 7. Errors

- Every failure uses the existing `ErrorEnvelope`.
- `AuthErrorCode`: `invalid_code`, `code_expired`, `too_many_attempts`, `invalid_credentials`, `mfa_required`, `invalid_mfa_code`, `reauth_required`, `csrf_failed`, `turnstile_failed`, `disposable_email`, `age_requirement`, `terms_required`, `handle_taken`, `handle_invalid`, `handle_reserved`, `password_too_short`, `password_too_long`, `password_breached`, `password_check_unavailable`, `staff_mfa_required`, `onboarding_required`, `mail_unavailable`, `rate_limited`.
- Mail relay failure: 503 `mail_unavailable`, the flow stays valid for retry.
- Logs never contain emails, codes, tokens, passwords or TOTP secrets (existing scrubbing plus key-based redaction for `code`, `token`, `password`, `session`).

## 8. Configuration and secrets

New variables, validated at startup by `apps/api/src/config.ts` (the API refuses to start if any is missing or malformed):

| Variable | Format |
|---|---|
| `APP_ORIGIN` | URL, e.g. `http://localhost:8081` in dev |
| `AUTH_HMAC_KEY` | 32+ bytes, base64 |
| `IP_HASH_KEY` | 32+ bytes, base64 |
| `TOTP_ENC_KEY` | `v1:` + 32 bytes base64 |
| `TURNSTILE_SECRET_KEY` | string |
| `SMTP_URL` | `smtp://` or `smtps://` URL |
| `MAIL_FROM` | `korbat <no-reply@...>` |
| `TERMS_VERSION` | string, e.g. `draft-2026-09` |

The web app reads `EXPO_PUBLIC_TURNSTILE_SITE_KEY`. `infra/.env.example` gains the keys with placeholder values; local `.env` files are generated with random values, as in Foundation.

## 9. Web screens

Expo routes under `apps/app/src/app/`:

| Route | Purpose |
|---|---|
| `(auth)/index.tsx` | Email entry with Turnstile |
| `(auth)/code.tsx` | Code entry, resend with cooldown |
| `(auth)/age.tsx` | Date of birth and terms acceptance |
| `(auth)/handle.tsx` | Handle and display name |
| `(auth)/password.tsx` | Password sign-in |
| `(auth)/mfa.tsx` | TOTP or recovery-code challenge |
| `settings/security.tsx` | Sessions and devices, MFA setup with QR, recovery codes, set or change password, sign out everywhere, re-auth prompt |
| `terms.tsx` | Draft terms page |
| `not-me/[token].tsx` | Confirm "This wasn't me" |

The web client never reads the session token; it sends `credentials: "include"` and echoes the CSRF cookie in `X-CSRF-Token`. A shared API client in `apps/app/src/lib/api.ts` handles this, and maps `ErrorEnvelope` codes to messages.

## 10. Testing

- **Unit** (`apps/api/test/auth/`): token hashing, AES-GCM round trip and tamper detection, email-code expiry and attempt limit, TOTP window and replay, recovery-code consumption, lockout timing, handle rules and reserved list, CSRF and Origin checks, cookie attributes, age calculation at the 16th birthday boundary, disposable-domain matching, config validation of the new variables.
- **Architecture**: the boundary test in 2.2.
- **Integration** against Compose (Postgres, Redis, Mailpit), reading codes from Mailpit's HTTP API:
  - sign-up through onboarding; sign-in by code; sign-in by password; lockout, unlock after 15 minutes, and email-code sign-in still working while locked;
  - MFA setup, challenge, replay rejected, recovery code, re-enrolment, disable;
  - re-authentication gates; session list, revoke, revoke all, sign out;
  - new-device email and "This wasn't me";
  - staff role grant via CLI and `requireStaffMfa`;
  - under-16 rejection writes nothing to Postgres;
  - `korbat_api` cannot read `auth.auth_events`; `korbat_auth` cannot delete from it;
  - timing: `email/start` and `password/signin` for unknown versus known emails differ by less than 50 ms on the median of 20 requests.
- **Web**: a scripted browser check of every screen in the plan. Automated browser end-to-end tests start in sub-project 2.

## 11. Dependencies to add

Pinned to the newest version that is at least 7 days old at planning time (the workspace enforces a 7-day minimum release age):

| Package | Version found 2026-09-14 | Used in |
|---|---|---|
| `@node-rs/argon2` | 2.2.0 | API, kept outside the tsup bundle (native module) |
| `nodemailer` | 10.0.0 | API |
| `uqr` | 0.1.3 | API (QR code as SVG; MIT, no dependencies) |
| `@types/nodemailer` | 6.4.24 | API, development only (nodemailer 10 ships no types) |
| `@marsidev/react-turnstile` | 1.6.1 | Web app (MIT, no dependencies) |

The API Docker image changes to ship `@node-rs/argon2` and its musl binary as a real dependency next to the bundle.

## 12. Success criteria

1a is done when:
1. A new person can sign up on the web, pass the age check, choose a handle, enable MFA, sign out, and sign back in with a code and TOTP.
2. Every integration test in section 10 passes against the Compose stack.
3. The architecture test passes and fails when a deliberate boundary violation is introduced.
4. Semgrep and the dependency audit stay clean.
5. `korbat_api` still cannot read anything in the `auth` schema.

## 13. Amendments from the dry run (2026-09-14)

The plan was dry-run task by task in a scratch clone before the execution prompts were written. Where the built system differs from sections 1 to 12, this section is the verified version.

Each item is a place where the verified build differs from `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`. The spec gets these edits when the plan and prompts are written into the real repo.

### Guards and responses (section 2.1, section 5)

- **requireSession.** 401 `unauthenticated` without a session, and 403 `onboarding_required` for a session whose account has no handle yet. The spec said 401 for both.
- **Rotated sessions.** Routes that rotate the session return JSON with an optional `token`, present only for bearer (native) clients. Web clients get fresh cookies instead.
  - `POST /api/auth/onboarding/handle` returns `{ profile, token? }`.
  - `POST /api/auth/password/set` returns 200 `{ token? }`. The spec said 204, which cannot carry the native token.
  - `POST /api/auth/mfa/totp/confirm` returns `{ recoveryCodes, token? }`.
- **Contracts additions.** `RotatedToken`, `PasswordSetResponse` and `TotpConfirmResponse`.
- **Cookie refresh.** When a cookie session's idle expiry slides, both cookies are re-sent with the same CSRF value, so requests already in flight stay valid.

### Encryption at rest (section 2.1, `crypto.ts`)

- **GCM tag length.** AES-256-GCM pins the 16-byte authentication tag with `authTagLength` for both encryption and decryption. Payloads too short to hold the IV, the full tag and one byte of ciphertext are rejected. Semgrep flagged the unpinned version as allowing forged ciphertexts with shorter tags.

### Internal file layout (section 2.1 table)

| Spec | Built |
|---|---|
| `codes.ts` | code generation and checks live in `flows/email.ts` |
| `csrf.ts` | `cookies.ts` (cookies, CSRF double submit, Origin check, bearer parsing) |
| `events.ts` | `repo.appendEvent` |
| `flows/sessions.ts` | `flows/account.ts` (me, list, revoke, revoke all, sign out) |
| `data/disposable-domains.txt` | `data/disposable-domains.ts`, generated by `scripts/update-disposable-domains.mjs` |
| not listed | `context.ts`, `kv.ts`, `limits.ts`, `identifiers.ts`, `age.ts`, `middleware.ts`, `admin.ts`, `flows/signin.ts`, `index.ts` |

### Staff CLI (section 5.7)

- **Audit entry.** `grant-role` writes `targetType: "user"`, `targetId: <user id>` and `metadata: { from, to, via: "cli" }`. No email address is written.
- **Exit codes.** 2 for a usage error, 1 for a failure such as an unknown email.

### Boundary test (section 2.2)

- **Rules.** All four rules are implemented as plain functions with synthetic tests for each.
- **Violation gate.** The task also proves the suite fails when a real file imports `./auth/passwords`.

### Docker and configuration (section 8, section 11)

- **argon2 packaging.** argon2 stays outside the tsup bundle. The API image copies `node_modules/@node-rs` from the Alpine build stage, which holds exactly the musl binary for the image's architecture.
- **Bundle chunks.** Three entry points (`index`, `migrate`, `grant-role`) make tsup emit shared chunks, and the whole `dist/` directory is copied.
- **Docker auth settings.** They live in `infra/.env` as `API_<NAME>`. `compose.yml` refuses to start while any is missing.
- **Shared keys.** `scripts/gen-dev-env.mjs` shares `AUTH_HMAC_KEY`, `IP_HASH_KEY` and `TOTP_ENC_KEY` between `infra/.env` and `apps/api/.env`. Without that, a TOTP secret enrolled through one API could not be decrypted by the other.
- **Turnstile in the CSP.** The Caddy CSP adds `https://challenges.cloudflare.com` to `script-src` and `frame-src`.
- **Smoke test.** `scripts/smoke-auth-stack.mjs` checks the stack end to end through Caddy.

### Web (section 9)

- **Root route.** The Foundation home screen at `src/app/index.tsx` is deleted, because `(auth)/index.tsx` owns `/`. A finished account is redirected to `/settings/security`.
- **Flow state.** Email address, flow id and MFA ticket are kept in memory (`src/lib/flow.ts`), never in the URL. A reload restarts the flow.
- **Terms version.** `TERMS_VERSION` is a constant next to the terms text in `src/lib/terms.ts` and must equal the API's `TERMS_VERSION`.
- **QR code.** The TOTP QR code renders through `QrCode.web.tsx` as a plain `<img>` on web, because React Native Web's `Image` did not draw the SVG data address. Native uses `QrCode.tsx` with React Native's `Image`.
- **Error messages.** The API client shows the server's error message, which is written for people, and falls back to local wording only for `invalid_request`, `internal` and unparseable responses.
- **Dependencies.** The web app gains `zod` 4.5.4 (already locked for contracts) next to `@marsidev/react-turnstile` 1.6.1.

### Tests (section 10)

- **Shared HTTP client.** `test/integration/http-client.ts` provides a cookie browser and a native client, each with its own client address so per-IP limits never collide.
- **Mailpit inbox.** The Mailpit helper gains an inbox that hands out each new message once.
- **Moving clock.** The end-to-end suite moves a clock through `createAuth({ now })` for lockout expiry, the re-auth window and new TOTP steps.
- **Redis prefix.** Redis-backed suites use a fresh key prefix per run, so rate-limit counters from earlier runs never interfere.

### Task split

- **T16 to T18.** T16 is the HTTP layer. T17 is the boundary test and grant-role CLI. T18 is the end-to-end and timing tests.
- **T19 to T21.** T19 is Docker. T20 is the web screens. T21 is the site key in the web image, the browser check, CI and docs.

## 14. Amendments from the audit (2026-09-23)

Applied by `docs/superpowers/specs/2026-09-23-audit-fixes-design.md` (Tasks 3, 4 and 5 of its prompts). Where this document and the audit design differ, the audit design is current.

- **Fresh authentication for enrolment (section 5.3).** `POST /api/auth/mfa/totp/setup`, `POST /api/auth/mfa/totp/confirm` and `DELETE /api/auth/sessions/:id` require a re-authentication within five minutes, whether or not two-factor is already on. A sign-in counts as fresh.
- **Owners hear about security changes (section 5).** Templates `mfa_enabled`, `mfa_disabled`, `password_changed`, `recovery_codes_regenerated` and `sessions_revoked_all` are sent best effort. A "this wasn't me" link also revokes the device its alert was about.
- **Pending sign-ups are keyed by the hash of the flow id (section 2.1).** `flow:` and `signup:` keys hold `sha256(flowId)`, like sessions and tickets.
- **The two limits section 6 named exist:** `signup/complete` 10 per address an hour, `onboarding/handle` 10 per session an hour. Every `rate_limited` answer carries `Retry-After`.
- **A browser is a web client (section 4).** A request carrying `Sec-Fetch-Mode` or `Origin` is treated as `platform: web`, whatever the body says, so no script on the app origin can obtain a bearer token.
- **Revocation outlives the cache (section 4).** Revoking writes a tombstone under the session cache key; a cache fill never overwrites one.
- **Passwords are re-hashed at sign-in** when their parameters are older than the current ones, and **previous TOTP keys** (`TOTP_ENC_KEYS_PREVIOUS`) decrypt a secret that is then re-encrypted with the current key.
- **Malformed JSON is `invalid_request` with status 400**, not an internal error.
- **The client address (section 6).** `TRUST_PROXY` (`cloudflare`, `caddy`, `none`) decides which header names the client; every per-address limit and audit row uses the keyed hash of that address, never the address. Production refuses Cloudflare's Turnstile test secrets, plain-http origins and a mail relay without TLS.
- **The retention job is in scope (section 1, previously out of scope).** Every ten minutes the API deletes email codes consumed or expired a day ago and sessions revoked or expired a month ago, nulls device address hashes not seen for 30 days (the design's IP-hash purge), and removes security events older than 90 days through `auth.purge_events`, a function the migrator owns so the table stays append-only for the API role.
````

### Replace `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md` (whole file)

````markdown
# korbat sub-project 2a: Posting and Feed (text) — Design

Date: 2026-09-17. Status: approved in brainstorm, awaiting written review.

## Context

Sub-project 2 of the korbat design (`2026-09-03-korbat-design.md`, build-order row 2) covers posting and the feed. It is split into three slices so that each ships something usable and each plan stays reviewable:

- **2a (this spec):** text posts, replies, quotes, likes, reposts, bookmarks, follows, blocks, mutes, the Following and Latest timelines, thread and profile pages, handle lookup, write limits, and the web screens.
- **2b:** images end to end: upload, the worker pipeline (re-encode, EXIF strip, blurhash, NSFW score), alt text, media in the composer and in lists.
- **2c:** explore: the ranked view, its refresh job and tab.

Foundation created every table this slice needs (`posts`, `post_media`, `follows`, `blocks`, `mutes`, `likes`, `reposts`, `bookmarks`, `profiles`) with row-level security and the main indexes. 1a provides sessions, the `requireSession` and `requireOnboarding` guards, cookie and bearer transport, and the profile store. Nothing in 2a touches the `auth` schema.

## Decisions

| Topic | Decision |
|---|---|
| Slicing | 2a text, 2b images, 2c explore |
| Feed contents | Top-level posts, quotes and reposts from followed accounts plus your own; replies only in threads and a profile tab |
| Blocks | Full block enforced server-side in every read and write; the interface states that public posts stay readable signed out |
| Mutes | One-way and silent; hide the muted account's posts and reposts from your timelines only |
| Deletion | Sets `deleted_by_author`, blanks the body in the database, leaves a tombstone for ancestors and quotes |
| Editing | None; delete and repost |
| Visibility | Counts public; liker lists never exposed to anyone; follower and following lists for signed-in accounts; likes and bookmarks private to their owner |
| Write limits | Spec numbers tiered by account age; reputation tiers arrive in sub-project 3 |
| Discovery | Public Latest timeline and exact handle lookup until 2c |
| Reading signed out | Latest, threads and profiles are public; everything personal needs a session |
| Architecture | Timelines served straight from Postgres; counters as columns on posts and profiles; a `social` module in the API shaped like the auth module |

## 1. Scope

In scope:
- Posts of 1 to 1000 characters, replies, quotes.
- Likes, reposts, bookmarks and their undos.
- Follows, blocks, mutes and their undos, with lists of who you block and mute.
- Following timeline, Latest timeline, thread view, profile pages with Posts and Replies tabs, private Likes and Bookmarks lists, follower and following lists.
- Exact handle lookup.
- Per-account write limits tiered by account age.
- Rendering of the moderation states `withheld` and `removed` that sub-project 3 will set: visible with a chip to the author, hidden from everyone else.
- Web screens for all of the above, and the route change that makes the timeline the home page.

Out of scope, with the slice or sub-project that owns it:
- Images and any media (2b).
- Ranking, explore, search, hashtags (2c).
- Notifications of any kind (native builds, sub-project 5, or a later slice).
- Mentions as data: `@handle` and links are made clickable in the client only; no mention table or index.
- Profile editing, display name and bio changes (1b).
- Reporting and moderation actions (3).
- Reputation (3). 2a keys tiers off account age only.

## 2. Architecture

### 2.1 The social module

All code for this slice lives in `apps/api/src/social/`. Like the auth module, only `apps/api/src/social/index.ts` may be imported from outside the folder. It exports `createSocial(deps)`, which returns `routes`, a Hono sub-app the app mounts at `/api`, plus the types the app and tests need.

| File | Responsibility |
|---|---|
| `repo.ts` | Every SQL statement, through the `korbat_api` pool: posts, engagement, graph, timelines, profiles, counters |
| `cursor.ts` | Keyset cursor encode and decode |
| `text.ts` | Body normalization and validation |
| `tiers.ts` | Account-age tiers and the limit numbers |
| `limits.ts` | Per-account write limits on top of the rate-limit store |
| `visibility.ts` | The rules for what a viewer may see: state, blocks, mutes, ownership |
| `flows/posts.ts` | Create, get, delete, thread |
| `flows/engagement.ts` | Like, repost, bookmark and their undos |
| `flows/graph.ts` | Follow, block, mute and their undos; blocked and muted lists |
| `flows/timelines.ts` | Following, Latest, profile Posts and Replies, private Likes and Bookmarks |
| `flows/profiles.ts` | Profile view with viewer relation; follower and following lists |
| `routes.ts` | HTTP layer: validation with contracts, calls flows, shapes responses |
| `context.ts` | `SocialDeps`, `SocialError`, error messages |

Dependencies are injected: the API database pool, the rate-limit store, a clock, the logger. No Redis client beyond the rate-limit store; no mailer.

The app mounts `social.routes` at `/api` next to the auth routes. Every write route runs behind the auth module's `requireSession`, which already enforces onboarding, CSRF and Origin checks.

### 2.2 Boundary enforcement

`apps/api/test/architecture.test.ts` gains two rules:
- a file outside `src/social/` imports nothing inside `src/social/` other than `src/social/index.ts`;
- a file inside `src/social/` imports no `auth`-schema table from `@korbat/db` (the module works only with the public schema).

The existing rules stay: the social module reaches the auth module only through `src/auth/index.ts`, and never references the auth pool or auth keys.

### 2.3 Profiles

`apps/api/src/profiles/store.ts` (the 1a `ProfileStore`) keeps its two functions for onboarding. Profile reads that 2a needs (by handle, with counts and viewer relation) live in the social repository, because they join the graph tables.

### 2.4 Contracts

`packages/contracts/src/social.ts` holds every request and response schema for the endpoints in section 5 and the `SocialErrorCode` enum. `packages/contracts/src/index.ts` re-exports it. The shared `Pagination` schema (cursor, limit 1 to 50, default 20) is reused by every list.

## 3. Data model changes

One drizzle migration (`0004_*`), generated from the schema, plus nothing hand-written. Empty tables need no backfill.

`posts` gains:

| Column | Type | Purpose |
|---|---|---|
| `like_count` | integer not null default 0, check ≥ 0 | Shown on the post; never decremented below zero |
| `repost_count` | integer not null default 0, check ≥ 0 | |
| `reply_count` | integer not null default 0, check ≥ 0 | Counts replies that are not deleted |
| `quote_count` | integer not null default 0, check ≥ 0 | Counts quotes that are not deleted |
| `deleted_at` | timestamptz null | Set with `state = 'deleted_by_author'` |

`profiles` gains `follower_count`, `following_count` and `post_count` (integer not null default 0, check ≥ 0). `post_count` counts the account's non-deleted top-level posts and quotes; reposts and replies are not counted, even though the profile's Posts tab shows reposts.

New indexes:
- `posts (quote_of_id)` for quote lookups.
- `reposts (user_id, created_at)`, `likes (user_id, created_at)`, `bookmarks (user_id, created_at)` for per-account lists and the Following union.

Counters are updated in the same transaction as the action that changes them, using the number of rows the action actually inserted or deleted, so repeating an action never double-counts. Deleting a post decrements its parent's `reply_count` or its quoted post's `quote_count` and the author's `post_count` where applicable. Moderation states do not change counters.

Deletion blanks `body` to the empty string. The 1000-character check constraint allows it; the application never returns an empty body except as a tombstone.

## 4. Visibility rules

One function decides what a viewer may see, and every read uses it.

- **State.** Others see only `visible` posts. The author also sees their own `withheld` and `removed` posts, with the state in the response, and their own `deleted_by_author` posts nowhere except as tombstones.
- **Blocks.** If a block exists in either direction between the viewer and an author, the viewer sees none of that author's posts, replies or profile. Direct fetches answer `not_found`. Lists simply omit them. Writes are directional: when the target blocked the viewer, the write fails exactly like a read, with `not_found` or `post_unavailable`, so nothing is revealed; when the viewer blocked the target, the write fails with `blocked`, so the interface can say that unblocking comes first. The viewer's own blocks are listed on the privacy settings page, which is where unblocking happens.
- **Mutes.** The viewer's mutes remove the muted account's posts and reposts from the Following and Latest timelines. Threads and profiles are unaffected.
- **Tombstones.** A post appears as a tombstone only where its absence would break structure: as an ancestor in a thread, or as a quoted embed. A deleted post is a tombstone with `deleted: true`; a post the viewer may not see is a tombstone with `unavailable: true`. Tombstones carry no author, no body and no counts. Deleted and hidden posts are omitted from reply lists and timelines.
- **Signed out.** Latest, threads and profiles are readable without a session and carry no viewer fields. Following, likes, bookmarks, follower and following lists, and the blocked and muted lists need a session.

## 5. Flows and endpoints

All request and response bodies are defined in `packages/contracts/src/social.ts`. Every write needs a session (onboarded account) and is rate limited per section 6. `PostView` is the post shape used everywhere:

```ts
interface PostView {
  id: string;
  author: { id: string; handle: string; displayName: string; verified: boolean };
  body: string;
  createdAt: string;
  state: "visible" | "withheld" | "removed";   // never "deleted_by_author": deleted posts are tombstones
  replyTo: { id: string; authorHandle: string } | null;
  quoteOf: PostView | Tombstone | null;        // one level deep: the embedded post carries quoteOf: null; opening it shows its own quote
  counts: { likes: number; reposts: number; replies: number; quotes: number };
  viewer?: { liked: boolean; reposted: boolean; bookmarked: boolean };   // signed in only
}
interface Tombstone { id: string; deleted?: true; unavailable?: true }
interface Page<T> { items: T[]; nextCursor: string | null }
```

### 5.1 Posts

- `POST /api/posts` `{ body, replyToId?, quoteOfId? }` → 201 `PostView`. At most one of `replyToId` and `quoteOfId`. The body is normalized (section 6) and must be 1 to 1000 characters after normalization. The target of a reply or quote must be visible to the author, otherwise `post_unavailable`; if the author has blocked the target's author, `blocked`. Replying to or quoting your own post is allowed.
- `GET /api/posts/:id` → `PostView`, or `not_found` when the viewer may not see it.
- `DELETE /api/posts/:id` → 204. Author only, otherwise `not_author`. Idempotent.
- `GET /api/posts/:id/thread?cursor&limit` → `{ ancestors: (PostView | Tombstone)[], post: PostView, replies: Page<PostView> }`. Ancestors are the chain from the root down to the parent, at most 50 deep (a longer chain is cut at 50 and the client links to the oldest ancestor returned); replies are direct replies, oldest first. Deeper branches open through each reply's own thread page.

### 5.2 Engagement

- `POST /api/posts/:id/like`, `DELETE /api/posts/:id/like` → `{ counts, viewer }` with the post's updated counts and viewer flags.
- `POST /api/posts/:id/repost`, `DELETE /api/posts/:id/repost` → same shape. Reposting a reply is allowed; the repost appears in timelines like any other.
- `POST /api/posts/:id/bookmark`, `DELETE /api/posts/:id/bookmark` → same shape. Bookmarks change no counts.
- Doing an action twice, or undoing one that was not done, is a no-op that returns the current state.
- The target must be visible to the viewer, otherwise `not_found`; when the viewer has blocked the target's author, `blocked`. Someone who is blocked therefore cannot like, repost or bookmark the blocker's posts, and learns nothing from the refusal.

### 5.3 Graph

- `POST /api/profiles/:handle/follow`, `DELETE …/follow` → `{ following: boolean, followerCount: number }`. Following yourself is `self_target`. Following an account you block is `blocked`; following an account that blocks you is `not_found`, like every other read or write towards it.
- `POST /api/profiles/:handle/block`, `DELETE …/block` → `{ blocked: boolean }`. Blocking is one transaction: insert the block, delete follows in both directions, adjust follower and following counts. Unblocking restores nothing.
- `POST /api/profiles/:handle/mute`, `DELETE …/mute` → `{ muted: boolean }`.
- `GET /api/me/blocks`, `GET /api/me/mutes` → `Page<ProfileListItem>`, newest first.

### 5.4 Timelines and lists

`TimelineItem` is `{ kind: "post", post }` or `{ kind: "repost", post, repostedBy: author, repostedAt }`.

- `GET /api/timeline/following?cursor&limit` (session) → `Page<TimelineItem>`: top-level posts and quotes by followed accounts and by the viewer, plus reposts by followed accounts and by the viewer, ordered by post time or repost time, newest first. Blocks and mutes apply to both the author and the reposter.
- `GET /api/timeline/latest?cursor&limit` (public) → `Page<TimelineItem>` of every visible top-level post and quote, newest first, no reposts. A signed-in viewer's blocks and mutes apply.
- `GET /api/profiles/:handle/posts` (public) → `Page<TimelineItem>`: the account's top-level posts, quotes and reposts.
- `GET /api/profiles/:handle/replies` (public) → `Page<PostView>`: the account's replies, newest first.
- `GET /api/me/likes`, `GET /api/me/bookmarks` (session) → `Page<PostView>`, newest first by when the like or bookmark was made. Posts the viewer may no longer see are omitted.

The cursor encodes the sort time, the post id and, for repost items, the reposter id, as base64url JSON. It is opaque to clients and validated on decode; a malformed cursor is `invalid_request`.

### 5.5 Profiles

- `GET /api/profiles/:handle` (public) → `ProfileView`: `id`, `handle`, `displayName`, `bio`, `verified`, `createdAt`, `counts { posts, followers, following }`, and for a signed-in viewer `viewer { following, followedBy, blocked, muted }`. Handles match case-insensitively. A profile the viewer may not see (a block in either direction) is `not_found`.
- `GET /api/profiles/:handle/followers`, `GET /api/profiles/:handle/following` (session) → `Page<ProfileListItem>` where `ProfileListItem` is the author shape plus `bio` and `followedByViewer`.

There is no liker list endpoint and no search.

## 6. Abuse controls

**Body normalization** (`text.ts`): Unicode NFC, trim, CR LF to LF, at most two consecutive line breaks, and rejection of control characters other than tab and line feed. Length is counted in code points after normalization, which matches Postgres `char_length`. Bodies are stored and returned as plain text; the client renders text and turns `@handle` and `https://` links into links with `rel="noopener noreferrer nofollow"`. There are no link previews in 2a.

**Write limits** (`limits.ts`, `tiers.ts`): counted per account in the existing rate-limit store, on top of the per-IP global limit. The tier comes from `profiles.created_at`, the onboarding time, because auth-schema timestamps are out of the module's reach.

| Action | Account younger than 24 h | Established |
|---|---|---|
| Top-level posts and quotes | 5 per hour | 30 per hour |
| Replies | 20 per hour | 60 per hour |
| Reposts and quotes | refused for the first 48 hours (`account_too_new`) | 30 reposts per hour; quotes count as posts |
| Likes | 100 per hour | 100 per hour |
| Bookmarks | 100 per hour | 100 per hour |
| Follows | 50 per hour and 400 per day | 50 per hour and 400 per day |
| Blocks and mutes | 30 per hour | 30 per hour |

Exceeding a limit is `rate_limited` with `Retry-After`, as in the existing middleware. Undo actions are not limited. Sub-project 3 replaces the age check with reputation without changing the mechanism.

**Other refusals:** `self_target` for following, blocking or muting yourself; `blocked` for interacting with an account you have blocked; `not_found` or `post_unavailable` for anything towards an account that blocked you; `post_unavailable` for replying to or quoting a post the author may not see; `not_author` for deleting someone else's post.

## 7. Errors

New codes in `SocialErrorCode`, returned in the standard error envelope:

| Code | Status | When |
|---|---|---|
| `post_unavailable` | 400 | The reply or quote target is deleted, hidden, or not visible to the author |
| `not_author` | 403 | Deleting a post you did not write |
| `blocked` | 403 | Following, replying to, quoting, liking, reposting or bookmarking an account you have blocked (the other direction is `not_found` or `post_unavailable`) |
| `self_target` | 400 | Following, blocking or muting yourself |
| `account_too_new` | 403 | Reposting or quoting within 48 hours of onboarding |

Existing codes reused: `invalid_request`, `unauthenticated`, `onboarding_required`, `rate_limited`, `not_found`, `csrf_failed`.

## 8. Configuration

No new environment variables. The limit numbers are constants in `tiers.ts`; making them configurable is not needed until reputation tiers exist.

## 9. Web screens

Routes under `apps/app/src/app/`. The sign-in group's index moves from `/` to `/signin`; the auth screens' redirects to `/` now mean the home timeline, and the settings layout sends a signed-out visitor to `/signin`. A finished account lands on its feed, not on the security page.

| Route | Purpose |
|---|---|
| `index.tsx` | Home: Following and Latest tabs when signed in; Latest with a sign-in prompt when signed out |
| `post/[id].tsx` | Thread: ancestors, the post, replies; composer for a reply |
| `u/[handle]/index.tsx` | Profile with Posts and Replies tabs, follow, block and mute actions; a private Likes tab on your own |
| `u/[handle]/followers.tsx`, `u/[handle]/following.tsx` | Lists for signed-in viewers |
| `bookmarks.tsx` | Your bookmarks |
| `settings/privacy.tsx` | Blocked and muted accounts with one-tap undo |
| `(auth)/signin.tsx` | The former `(auth)/index.tsx` |

Shared pieces in `apps/app/src/components/`:
- `AppShell`: the spec's layout. Wide screens: navigation column, timeline column, context column holding the handle box (2c fills it). Narrow screens: single column, bottom tab bar (Home, Bookmarks, Profile) and a floating compose button. Same components at both widths.
- `PostCard`: author line, body with clickable handles and links, quoted embed or tombstone, action row with counts and the viewer's state, chip for the author's own withheld (amber) or removed (red) posts, repost header when shown as a repost.
- `Composer`: inline card at the top of the home timeline on wide screens; on narrow screens the floating button opens it as a sheet. Reply and quote reuse it with the target shown above. Character counter to 1000, disabled while sending, errors from the API shown inline.
- `Timeline`: cursor pagination with a load-more control at the end, pull to refresh on touch, a "new posts" insert at the top on refresh.
- `HandleBox`: opens `/u/:handle` for `@name` or `name`.

`apps/app/src/lib/api.ts` gains no new mechanism; the social contracts are parsed with the same `api()` helper. A small `social.ts` in `lib/` wraps the endpoints. 1a's `ui.tsx` primitives grow as needed.

Accessibility as in the design brief: keyboard navigation on web, reduced motion respected, WCAG AA contrast. The block confirmation dialog states that public posts stay readable to someone who signs out.

## 10. Testing

- **Unit** (`apps/api/test/social/`): contracts, cursor round trip and rejection of malformed cursors, tiers at the 24-hour and 48-hour boundaries, body normalization (NFC, line breaks, control characters, code-point length), the visibility function with every combination of state, ownership, block and mute.
- **Architecture:** the boundary rules in 2.2, with a deliberate violation proven to fail.
- **Integration** against Compose Postgres (`apps/api/test/integration/social-*.test.ts`):
  - counters stay exact when actions repeat and undo;
  - blocking removes follows in both directions in one transaction and adjusts counts;
  - Following pages stably across mixed posts and reposts, and a post reposted by two followed accounts appears twice with distinct cursors;
  - blocks filter both directions in every list; mutes filter timelines only;
  - deletion blanks the body, omits the post from lists, and yields a tombstone as an ancestor and as a quote;
  - withheld and removed posts are visible only to their author;
  - the API role still cannot read the `auth` schema (unchanged check, run again).
- **HTTP** (`http-social.test.ts`): two accounts created through the 1a flows; post, reply, quote, like, repost, bookmark, follow, block, unblock; `not_found` across a block; tier limits with a moved clock; signed-out reads of Latest, threads and profiles; every private list refused without a session.
- **Web:** typecheck and export in CI; a scripted browser check of every screen, as in 1a.
- **Docker:** the smoke test posts as the throwaway account and reads it back from Latest through Caddy.

## 11. Dependencies

None. Everything in this slice runs on packages already locked: Hono, Drizzle, zod, Expo, expo-router, NativeWind.

## 12. Success criteria

2a is done when:
1. A signed-in person can post, reply, quote, like, repost, bookmark, follow, block and mute on the web, and see a chronological Following timeline and a public Latest timeline.
2. Every integration and HTTP test in section 10 passes against the Compose stack.
3. The architecture test passes and fails on a deliberate violation of the social module boundary.
4. A blocked account gets `not_found` for the blocker's posts and profile and `blocked` for every interaction, proven by tests.
5. Semgrep and the dependency audit stay clean.
6. The Docker smoke test and the browser check pass on the built stack.

## 13. Amendments from the dry run (2026-09-17)

The plan was dry-run task by task in a scratch clone before the execution prompts were written. Where the built system differs from sections 1 to 12, this section is the verified version.

Each item is a place where the verified build differs from `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`. The spec gets these edits when the plan and prompts are written into the real repo.

### Module layout (section 2.1)

| Spec | Built |
|---|---|
| `text.ts` (body normalization) | `normalizePostBody`, `postLength` and the `PostBody` schema live in `packages/contracts/src/social.ts`, so the composer's counter applies exactly the server's rule; the module has no `text.ts` |
| `context.ts` | Also holds `SocialDeps` (repository, the rate-limit store for per-account limits, logger, clock) and `ViewerId` |
| not listed | `views.ts`: builds `PostView`s for one viewer (one-level quotes, tombstones, viewer state) and timeline items; `index.ts`: the module entry point |
| `flows/timelines.ts` | Also serves the profile Posts and Replies tabs and the private likes and bookmarks pages |

`createSocial(options)` takes the API pool, the rate-limit store, the logger, the auth module's `requireSession` middleware and an optional clock, and returns `deps` and `routes`.

### App wiring (section 2.1)

- **Optional in the app factory.** `AppDeps.social` is optional so the 1a HTTP tests keep building the app without a social module; the server always wires it. `app.ts` maps `SocialError` to the error envelope and sets `Retry-After` on `rate_limited`.

### Repository (section 2.1, section 3)

- **Raw SQL reads.** Reads use raw SQL through `db.execute`. That driver path returns timestamps as text and expands JavaScript arrays into parameter lists, so the repository formats timestamps as ISO text in SQL, parses them once in row mappers, passes cursor times as ISO strings, and sends id lists as one comma-joined parameter split with `string_to_array(...)::uuid[]`.
- **Millisecond timestamps.** Every row the repository writes gets its time from the clock rather than the database default, so keyset cursors (epoch milliseconds) round-trip exactly.
- **Repost cursor.** Timeline cursors carry the reposter id; a post reposted by two followed accounts is two items with distinct cursors.
- **Ancestor cap.** `MAX_ANCESTORS` is 50; the recursive query stops there and the client links to the oldest ancestor returned.

### Visibility and errors (sections 4, 5, 7)

- **Order of the rule.** A block in either direction wins over everything, even over a deleted post's tombstone reason, so a blocked viewer sees `unavailable`, never `deleted`.
- **Handles.** Flows tolerate a leading `@` in a handle; the route layer strips it anyway.
- **Profile viewer state.** Because a block in either direction makes a profile `not_found`, `viewer.blocked` on a visible profile is always false; the field stays for later slices.
- **Deleting someone else's post.** `not_author` only when the viewer could see the post; otherwise `not_found`.

### Web (section 9)

- **Post card actions.** Reply, Repost, Quote, Like, Save (bookmark) and, for the author, Delete. Quote opens the thread page with the compose sheet prefilled.
- **Composer placement.** Inline at the top of the home timeline from 768 px up; a floating button and a sheet below that. After posting, the timeline reloads.
- **Lists.** One `PagedList` (load more, pull to refresh) with `TimelineList`, `PostList` and `ProfileList` on top.
- **Blocking from a profile.** After confirming a block the app goes to the privacy settings page, because the blocked profile is no longer visible to the blocker.
- **Security page.** Now rendered inside the app shell, with a link to the privacy page.

### Tests (section 10)

- **Fixtures.** Social integration tests create `profiles` rows directly (no auth user behind them) and drive a clock that advances on every read, so list order never depends on the id tie-breaker.
- **HTTP tests.** Use the in-memory mailer for sign-up codes and a strictly increasing clock with an offset that ages accounts past the new-account tier.

## 14. Amendments from the audit (2026-09-23)

Applied by `docs/superpowers/specs/2026-09-23-audit-fixes-design.md` (Task 6 of its prompts). Where this document and the audit design differ, the audit design is current.

- **A block retracts engagement (section 5.3).** Blocking also deletes, both ways, the pair's reposts and likes of each other's posts, adjusting the counters in the same transaction. Unblocking restores nothing.
- **Undo never consults the block relation (section 5.2).** Unlike, unrepost and unbookmark remove the viewer's own row whatever stands between the accounts.
- **A pair lock (section 3).** Follow, block, like, repost, reply and quote take `pg_advisory_xact_lock` on the unordered pair of accounts and check for a block inside the transaction, so none of them can land across a concurrent block.
- **Hidden posts answer first (section 4).** A post's state is judged before the block direction, so a blocker probing ids learns nothing about hidden or deleted posts. Block and mute towards an account that blocks the viewer are `not_found`; the viewer's own block or mute can always be undone.
- **A reply's parent (section 5.1).** `replyTo.authorHandle` is null when the viewer could not open the parent: its author is blocked either way, or the parent is hidden or deleted.
- **Disguising characters (section 6).** Bodies, alt text and display names refuse bidirectional overrides and isolates, the zero-width space, the word joiner and the byte order mark; a body must have some visible text.
- **Follower and following pages** leave out accounts with a block in either direction before the page is cut, so pages stay full.
- **A failing limit store is `service_unavailable` (503) with `Retry-After: 30`**, for writes and for the global limiter alike; the write is not made.
- **Cursors and ids.** A cursor's time is bounded by what a date can hold (anything else is `invalid_request`), and post ids are lowercased on input.
- **Indexes (section 3).** `posts (reply_to_id, created_at, id)`, a partial `posts (created_at, id) where reply_to_id is null and state = 'visible'` for Latest, and `(to, created_at, from)` plus `(from, created_at, to)` on follows, blocks and mutes. The Following timeline applies the cursor, the filters and the limit inside each branch of its union.
````

### Replace `docs/superpowers/specs/2026-09-18-images-2b-design.md` (whole file)

````markdown
# korbat sub-project 2b: Images — Design

Date: 2026-09-18. Status: approved in brainstorm. The technical assumptions were then checked by experiment and source research (section "Research"), which changed a few numbers (section "Changes since the brainstorm"). Awaiting written review.

## Context

Sub-project 2 of the korbat design (`2026-09-03-korbat-design.md`, build-order row 2) was split into 2a text posting and feed (executed 2026-09-17), 2b images, and 2c explore. This is 2b: images on posts, end to end.

What exists today:

- `post_media` was created by Foundation and has never been written by any code.
- `apps/worker` is the Foundation skeleton: a Redis list consumer with one `noop` job.
- The Compose stack runs MinIO and a bucket-init job that no code uses.
- 2a's `social` module creates, deletes and hydrates posts. Its composer and post card are text only.
- The API applies `Cache-Control: no-store`, a 300-per-minute per-IP limit and session resolution to every request, and `/api/health` answers 503 when any check fails. Sections 5.5 and 9 adjust these for images.
- The 2a integration tests write fixture accounts and posts into the development database and leave them there. Some are future-dated by the tests' clock, so they sit on top of the public Latest timeline in development.

One fact changed under the main design. MinIO's community edition stopped publishing images in October 2025, entered maintenance mode in December 2025, was archived in April 2026, and its Docker Hub repositories were removed on 2026-09-11. The image korbat pins is the last one, from September 2025, and will get no security fixes.

## Decisions

| Topic | Decision |
|---|---|
| Storage | Two Docker volumes behind a small file protocol. MinIO leaves the stack. An S3 adapter can be added behind the same interface if it is ever wanted |
| Pipeline | The worker has no network and no credentials. Work is handed over through files. The API owns the database and finalizes rows |
| NSFW score (rule R1) | Moves to sub-project 3, to arrive with the review queue, CSAM matching and appeals. `nsfw_score` stays empty; the pipeline keeps a slot for it |
| Alt text | Required on every image, 1 to 1000 characters |
| Images per post | Up to 4, on posts, replies and quotes. A post needs text or at least one image |
| Formats | JPEG, PNG, WebP, AVIF and single-frame GIF in. WebP out, in two sizes. Animated images and HEIC are refused with a clear message |
| Serving | The API serves image files after a visibility check. Images of visible posts are public and cacheable for 5 minutes; everything else is for the author only and never cached |
| Originals | Never kept. The uploaded file is deleted as soon as processing ends |
| Test isolation | Integration tests run against a separate `korbat_test` database and Redis database 15. A script clears what 2a left in the development database |

## Research

Done on 2026-09-18 with sharp 0.35.4 (libvips 8.18.6) on Windows x64, Docker Desktop on WSL2, and primary sources. "Measured" means run in a scratch folder or a throwaway Compose project.

| Finding | Consequence |
|---|---|
| Measured: the prebuilt sharp binary contains SVG and TIFF loaders next to JPEG, PNG, WebP, GIF and AVIF. HEIC cannot be decoded | The decoder allowlist is necessary, not decoration |
| Measured: `sharp.block({operation: ["VipsForeignLoad"]})` refuses every format; unblocking the parent classes `VipsForeignLoadJpeg`, `VipsForeignLoadPng`, `VipsForeignLoadWebp`, `VipsForeignLoadNsgif` and `VipsForeignLoadHeif` admits exactly JPEG, PNG, WebP, GIF and AVIF. An unknown class name is ignored without an error | A typo would silently leave a format blocked or the allowlist incomplete. Tests must prove that each allowed format decodes and that SVG and TIFF do not |
| Measured: Ultra HDR and Apple gain-map JPEGs decode through the plain JPEG loader when the Ultra HDR loader is blocked, with byte-identical output | Phone photos are not refused, and the embedded gain-map image is dropped |
| Measured: `metadata().pages` is 2 or more for animated GIF and WebP without decoding frames. Source: libvips 8.18 has no APNG support and reads only the first frame | Animation is detected from `pages`; APNG from its `acTL` chunk; AVIF sequences from their brand |
| Measured: default output has no EXIF, GPS, ICC, XMP or IPTC, `autoOrient()` applies the EXIF rotation first, a ZIP appended to a JPEG does not reach the output, and a truncated JPEG is refused at `failOn: "error"` | The pipeline is a fresh encode. Nothing of the original file survives |
| Measured: the pixel limit is enforced from the header in about 3 ms | Decompression bombs are refused before any pixel is decoded |
| Measured: decode memory follows pixel count, not file size. At 48 MP: WebP 96 MB, 8-bit PNG 107 MB, progressive JPEG 255 MB, GIF 325 MB, 16-bit interlaced PNG 400 MB, AVIF 948 MB. AVIF at 20 MP: 423 MB, from a 932-byte file. AVIF at 12 MP: 281 MB. A 12 MP photo of pure noise takes 0.7 s for both sizes at about 107 MB | Pixel caps are per format: 16 MP for AVIF, 50 MP for the rest. The worker gets 768 MB. One image at a time |
| Source: sharp's `timeout()` is cooperative and may not interrupt a single blocking decoder call | The worker has its own watchdog that exits the process |
| Source: libvips honours `VIPS_BLOCK_UNTRUSTED` only if it is set before it loads. In this build it blocks SVG and two others, not TIFF | It is set as well, but the allowlist is the control that matters |
| Source: a critical libheif advisory was published on 2026-08-25 and fixed in sharp 0.35.4 the next day; the workaround was to block the HEIF loader. sharp fixes only its latest release | Formats can be switched off by configuration without a deploy. sharp is kept current, and the worst-case check is rerun after each upgrade |
| Source: many camera JPEGs, Samsung phones among them, raise libjpeg warnings such as "Invalid SOS parameters". sharp's default `failOn: "warning"` refuses them | `failOn: "error"`. The decoder has already run when a warning is raised, so this does not widen the attack surface; it only stops refusing ordinary photos |
| Source: sharp 0.35 has no install scripts; the platform binary is an optional dependency selected by operating system, CPU and libc | pnpm has nothing to block. The worker image must install inside Alpine, as the API image already does for argon2 |
| Source: sharp is Apache-2.0; the prebuilt libvips packages are LGPL-3.0-or-later, as a separate dynamically loaded library | No obligations for running it. If korbat images are ever distributed, ship the notices; the library is already replaceable |
| Measured: a named volume takes the image directory's owner even when its first mount is read-only, as long as the path exists in the image. Source: while a volume is empty, every container creation re-applies that image's owner | Both images create both mount paths owned by `node`. No init container is needed |
| Measured: a container with `network_mode: none` has only a loopback interface, still reports a file-based health check, gates `depends_on`, and accepts `docker compose exec`. The other side's volume gives `EROFS` | The isolation model works as designed |
| Source: a read-only mount cannot be remounted without `CAP_SYS_ADMIN`, which a non-root process with all capabilities dropped and `no-new-privileges` cannot get. Files written by the other container must still be treated as untrusted | The API checks every file it opens in the store (section 7.3). Without that, a compromised worker could plant a symlink to `/proc/self/environ` and have the API serve its own secrets |
| Source: `rename(2)` is atomic inside one mount and fails across mounts. A rename to a new name is not made durable by ext4 on its own | Temporary files live in the volume they are renamed in, and are `fsync`ed first |
| Source: Hono 4.13.5's `bodyLimit` reads a chunked body fully into memory before the handler runs | The upload route counts bytes itself while streaming to disk |
| Source: Cloudflare caches by file extension, `.webp` included, honours `public, max-age`, never caches `private` or `no-store`, and ignores request cookies in the cache key. Its default Browser Cache TTL of 4 hours overrides a shorter `max-age` | Image URLs end in `.webp`. Anything that depends on the viewer is `private, no-store`. The zone must be set to "Respect Existing Headers" |
| Source: Cloudflare's CSAM Scanning Tool is free on every plan and scans only content served from its cache | Public images must be cacheable, which they are. Sub-project 3 turns the tool on |
| Source: `expo-image` supports web; blurhash placeholders are decoded in JavaScript and need only `img-src blob:`, which the CSP already allows. On web the `<img alt>` comes from `accessibilityLabel`, not from `alt` | The post card passes `accessibilityLabel` |

Sources:

- MinIO: https://blog.vonng.com/en/db/minio-resurrect/ and https://stormdevelopments.ca/blog/minio-s-community-edition-is-archived-what-still-runs-in-2026/
- sharp: https://sharp.pixelplumbing.com/security/ , https://sharp.pixelplumbing.com/api-utility/ , https://sharp.pixelplumbing.com/api-constructor/ , https://sharp.pixelplumbing.com/changelog/v0.35.0/ , https://github.com/lovell/sharp/security/advisories
- libvips: https://github.com/libvips/libvips/blob/8.18/libvips/iofuncs/operation.c , https://github.com/libvips/libvips/blob/8.18/libvips/iofuncs/init.c , https://github.com/libvips/libvips/discussions/3705
- Docker: https://docs.docker.com/engine/storage/volumes/ , https://github.com/moby/moby/issues/45714 , https://docs.docker.com/engine/network/drivers/none/ , https://docs.docker.com/engine/containers/resource_constraints/ , https://man7.org/linux/man-pages/man2/rename.2.html
- Hono: https://github.com/honojs/hono/blob/v4.13.5/src/middleware/body-limit/index.ts , https://github.com/honojs/hono/security/advisories/GHSA-9vqf-7f2p-gf9v
- Cloudflare: https://developers.cloudflare.com/cache/concepts/default-cache-behavior/ , https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/ , https://developers.cloudflare.com/cache/reference/csam-scanning/
- Caddy: https://caddyserver.com/docs/caddyfile/directives/request_body
- expo-image: https://docs.expo.dev/versions/v57.0.0/sdk/image/ , https://github.com/expo/expo/blob/sdk-57/packages/expo-image/src/ExpoImage.web.tsx

## Changes since the brainstorm

The brainstorm fixed the decisions above. Research changed these details:

- The side limit rises from 10,000 to 16,383 pixels, so phone panoramas pass. Memory is governed by the pixel caps, not the side.
- AVIF gets its own cap of 16 MP.
- The worker's memory limit is 768 MB, not 512 MB.
- New: a free-space floor for uploads, a configuration switch per format, a watchdog in the worker, checks on every file the API opens in the store, an own rate-limit bucket and no session lookup for public image requests, an advisory health check for the worker, and a Cloudflare setting that deployment must apply.
- The test environment file is derived from the development one, and the integration test configuration loads it by itself. Tests no longer depend on the shell having sourced a file.

## 1. Scope

In scope:

- Uploading, processing, storing, serving and deleting images on posts, replies and quotes.
- Required alt text.
- The composer: picking images in the browser, previews, a description per image, processing state.
- The post card: an image grid with blurhash placeholders, an ALT control, a full-screen viewer, thumbnails in quoted posts.
- Compose: MinIO removed, two volumes added, the worker isolated and limited.
- Test isolation and the cleanup of 2a's fixtures.

Out of scope, with its owner:

- NSFW scoring, the composer warning and automatic withholding (sub-project 3).
- Turning on CSAM scanning and purging the CDN on removal (sub-project 3). 2b only shapes the URLs for it.
- Avatars and banners (1b). They will reuse this pipeline.
- Animation and video (v2 in the main design).
- A native image picker (sub-project 5). On native the add-image button is hidden.
- Cropping, editing, reordering, paste and drag-and-drop, and an upload percentage.
- Imports from other platforms (3b). See section 14.
- Backups of the store volume (sub-project 4).

## 2. Architecture

### 2.1 Pieces

- **`packages/media-protocol`** (new, depends only on zod): the contract between the API and the worker. Limits, directory layout and path helpers, the result file schema, failure reasons, and the byte sniffers (format by magic bytes, APNG by its `acTL` chunk, AVIF sequences and HEIC by brand).
- **`apps/worker`** (rewritten): the image processor. It loses `ioredis`, `@korbat/db` and the Foundation job registry, and gains `sharp` and `blurhash`. Files: `config.ts`, `pipeline.ts` (everything that touches sharp), `loop.ts` (one tick: heartbeat, deletions, processing, cleanup), `index.ts`.
- **`apps/api/src/media/`** (new module, shaped like `auth` and `social`): `context.ts` (`MediaError`, dependencies), `files.ts` (the API's side of the protocol and the safe open), `repo.ts` (every SQL statement on `post_media`), `flows/upload.ts`, `flows/status.ts`, `flows/remove.ts`, `flows/serve.ts`, `sweeper.ts`, `routes.ts`, `index.ts`.
- **`apps/api/src/social/`**: creating a post attaches images, deleting one detaches them, and views carry them. It reaches `post_media` only through the media module's interface.
- **Compose**: `minio` and `minio-init` leave. `media-uploads` and `media-store` arrive. The worker is cut off from the network.

### 2.2 The file protocol

```
media-uploads   API read-write, worker read-only   /media/uploads
  tmp/<id>.part          a body being received
  incoming/<id>          a complete upload waiting for the worker
  delete/<id>            a request to delete image <id>

media-store     worker read-write, API read-only   /media/store
  files/<aa>/<id>/small.webp, large.webp           <aa> = first two characters of the id
  results/<id>.json      the outcome, written last
  attempts/<id>          how often processing started
  tmp/                   files being written
  heartbeat              rewritten every 10 seconds
```

A result is `{ "v": 1, "id", "status": "ready", "width", "height", "blurhash" }` or `{ "v": 1, "id", "status": "failed", "reason" }`. Width and height are those of `large.webp`, after rotation.

Rules:

1. Each side writes only its own volume. A file is written under that volume's `tmp/`, `fsync`ed, and renamed into place, so the other side never sees half a file.
2. Ids are UUIDs that the API makes with `randomUUID`. Both sides ignore every entry whose name is not a lowercase UUID (plus `.json` or `.part` where that applies) or that is not a regular file. No name or path from a user ever reaches the file system.
3. The result file is the commit point. An upload without a result is unprocessed and is simply processed again.
4. The upload is deleted by the API once the row is final. A result whose upload is gone has been consumed, and the worker removes it.
5. A delete request is removed by the API once the image folder and result are gone.

### 2.3 The worker

One loop, one image at a time. Each tick (every 500 ms, without overlap):

1. Rewrite `heartbeat` if 10 seconds have passed.
2. For every `delete/<id>`: remove `files/<aa>/<id>/`, `results/<id>.json` and `attempts/<id>`.
3. For every `incoming/<id>` without a result, oldest first: process it.
4. Remove every result whose upload is gone.

Processing one upload:

1. Read `attempts/<id>`. At 3, write a `processing_failed` result and stop. Otherwise write the count plus one. This happens before any decoding, so a file that kills the process is retried at most three times.
2. Sniff the first bytes. Refuse anything that is not an enabled format, and refuse HEIC, APNG and AVIF sequences. No decoder has run yet.
3. Read metadata. Refuse more than one page (`animated_not_supported`), a format that does not match the sniff, an AVIF whose compression is not AV1, more than 16,383 pixels on a side, and more than the format's pixel cap (`image_too_large`). The pixel cap is also passed to sharp as `limitInputPixels`, which enforces it from the header.
4. For each size: `sharp(path, { limitInputPixels, failOn: "error", sequentialRead: true }).autoOrient().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }).webp({ quality, effort: 4 }).timeout({ seconds: 30 })`. Sizes are `large` (long edge 2048, quality 82) and `small` (1024, quality 80). Transparency is kept. Output is sRGB without any metadata, which is sharp's default.
5. Blurhash: `small.webp` reduced to fit 32 by 32 pixels, encoded with 4 by 3 components.
6. Write both files, then the result.

A decode error becomes `corrupt_image`. Any other error becomes `processing_failed`. A watchdog ends the process if one upload takes longer than 120 seconds; Docker restarts the container and the attempt counter does the rest.

At start the worker sets `VIPS_BLOCK_UNTRUSTED` before sharp loads, blocks `VipsForeignLoad`, unblocks the enabled formats' classes, and sets `sharp.cache(false)` and `sharp.concurrency(1)`. It logs ids and reasons, never bytes or user data.

### 2.4 The media module

`createMedia(options)` takes the API pool, the uploads and store directories, the enabled formats, the free-space floor, the rate-limit store, the Redis client (for the sweeper's lock), the logger, the auth module's `requireSession` and `resolveSession`, an `enforceUploadLimit` function, and an optional clock. It returns:

- `routes`: upload, status and removal, mounted under `/api/media`.
- `fileRoutes`: the image file route, mounted before session resolution (section 5.5).
- `forPosts`: the interface the social module uses (section 2.5).
- `sweep(now)` and `startSweeper()`: section 4.7.
- `healthCheck`: fails when the heartbeat is older than 60 seconds or free space is under the floor.

`enforceUploadLimit` is built in `src/index.ts` from the social module's write-limit function, so all per-account write limits stay in one table and the two modules do not import each other's internals.

### 2.5 The social module

`createSocial` takes an optional `media` with four functions. Without it, posts carry no images and attaching any is `media_unavailable`, so the 2a tests keep working unchanged.

- `attach(tx, { postId, ownerId, items })`: inside the post's transaction. One statement sets `post_id`, `position` and `alt_text` on rows that belong to the author, are `ready` and are not attached. Fewer updated rows than items rolls the post back with `media_unavailable`.
- `detachAll(tx, postId)`: inside the delete transaction. Deletes the rows and returns their ids.
- `requestDeletion(ids)`: after the commit. Writes the delete requests.
- `forPosts(postIds)`: one query for a page of posts, quoted posts included.

### 2.6 Boundary enforcement

The architecture test gains these rules, each proven by a deliberate violation:

- Code outside `apps/api/src/media/` imports only `media/index.ts`.
- Only the media module mentions `postMedia` or `post_media`.
- The media module does not import from `auth/` or `social/` internals.
- `apps/worker` does not depend on or import `@korbat/db`, `ioredis`, `postgres` or any network client.
- Only `apps/worker/src/pipeline.ts` imports `sharp`.

### 2.7 Contracts

New in `packages/contracts/src/media.ts`: `MEDIA_MAX_BYTES` (20 MiB), `MEDIA_MAX_PER_POST` (4), `MEDIA_ACCEPTED_TYPES`, `ALT_MAX_LENGTH` (1000), `normalizeAltText` (NFC, runs of whitespace to one space, trim), `AltText` (no control characters, 1 to 1000 code points after normalization), `MediaErrorCode`, `MediaFailure`, `UploadResponse`, `MediaStatusResponse` and `MediaView`:

```
MediaView = { id, width, height, blurhash, alt, small, large }
```

`small` and `large` are paths such as `/api/media/<id>/small.webp`, so the server can move images later without a client change.

Changed in `social.ts`: `CreatePostRequest` gains `media: [{ id, alt }]` (at most 4, distinct ids, default empty). `body` may be empty, and a refinement requires text or at least one image. `PostView` and `QuotedPost` gain `media: MediaView[]`, always present. Tombstones carry none.

## 3. Data model changes

`post_media` is reworked in place. It has no rows in any environment, so required columns are added without a backfill.

| Column | Change |
|---|---|
| `owner_id` | new, required, references `profiles` with cascade |
| `status` | new enum `media_status`: `processing`, `ready`, `failed`; default `processing` |
| `error` | new, the failure reason |
| `created_at` | new, required |
| `post_id`, `position` | become optional; set when the image is attached |
| `width`, `height`, `blurhash` | become optional; set when the image is ready |
| `path` | dropped. The location follows from the id |
| `alt_text`, `nsfw_score` | unchanged. `nsfw_score` stays empty until sub-project 3 |

Checks: a `ready` row has width, height and blurhash; an attached row is `ready` and has a position from 0 to 3 and alt text; alt text has at most 1000 characters. Indexes: the existing unique `(post_id, position)`, plus `(owner_id, created_at)` for the pending count and `(status, created_at)` for the sweeper. Row-level security stays as it is.

`posts.body` already allows an empty string. A post without text and without images is refused by the API.

## 4. Lifecycle

### 4.1 Upload

`POST /api/media` with the file as the raw body. The API checks the session, the upload limit, the pending count and free space, then the declared type. It reads the first bytes and sniffs them, streams the body to `tmp/<id>.part` while counting bytes, stops at 20 MiB, inserts a `processing` row, renames the file into `incoming/`, and answers `202 { id, status: "processing" }`. The row comes before the rename, so the worker never processes an upload nobody owns. A disconnect or an error deletes the partial file.

### 4.2 Process

Section 2.3.

### 4.3 Finalize

Whoever looks first finalizes: `GET /api/media/:id` from the composer, or the sweeper. It reads the result through the safe open, updates the row only if it is still `processing`, and deletes the upload. It is safe to repeat.

### 4.4 Attach

`POST /api/posts` with `media`. Section 2.5.

### 4.5 Serve

Section 5.5.

### 4.6 Delete

- Deleting a post detaches its images in the same transaction and requests their deletion after the commit. Serving stops with the commit, because the rows are gone.
- `DELETE /api/media/:id` removes an upload that is not attached.
- The sweeper removes what nobody attached.

### 4.7 The sweeper

Every 30 seconds in the API, under a Redis lock so that one instance runs it. `sweep(now)` is a plain function, which tests call with a moved clock.

1. Finalize `processing` rows that have a result.
2. Fail `processing` rows older than 5 minutes (`processing_failed`), delete their upload and request deletion.
3. Remove rows that were never attached and are older than 24 hours, with their files.
4. Remove delete requests whose image folder and result are gone.
5. Every 10 minutes, reconcile: request deletion of image folders older than an hour that have no row, and delete uploads and partial files older than an hour that have no row. This cleans up after a crash between a commit and a file operation, and after account deletion, where rows go by cascade.

## 5. Endpoints

### 5.1 `POST /api/media`

Session required. Body: the file. `Content-Type` must be one of the accepted types; it is checked and then forgotten. Answers `202 { id, status }`. Errors: section 8.

### 5.2 `GET /api/media/:id`

Session required, owner only, otherwise `not_found`. Answers `{ id, status, error?, width?, height?, blurhash? }` and finalizes first if a result is waiting.

### 5.3 `DELETE /api/media/:id`

Session required, owner only, only while not attached. Answers 204.

### 5.4 `POST /api/posts`

Accepts `media`. Every other rule of 2a applies unchanged: reply and quote targets, blocks, tiers, limits.

### 5.5 `GET /api/media/:id/small.webp` and `/large.webp`

- The post is visible: the file, with `Cache-Control: public, max-age=300` and an `ETag`. No session is looked up.
- The post is withheld or removed: the route resolves the session itself, and serves the author with `Cache-Control: private, no-store`. Everyone else gets 404.
- No row, not ready, not attached, or post deleted: 404.

A block is not checked here. 2a already states that posts are public to anyone who signs out, and its block screens say so; an image follows its post.

`If-None-Match` answers 304 after the same checks. The response always has `Content-Type: image/webp`, and the API's existing headers apply: `nosniff`, a CSP of `default-src 'none'`, and `Cross-Origin-Resource-Policy: same-origin`, which also stops other sites from embedding the images.

Three changes in `app.ts` make this work:

- `fileRoutes` is mounted before `auth.resolveSession`, so public image requests cost one query.
- These requests are exempt from the 300-per-minute global limit and have their own bucket of 1200 per minute per IP. A timeline page can hold 80 images.
- `noStore` sets its header only when the handler set none.

## 6. Limits and abuse controls

| Limit | Value |
|---|---|
| File size | 20 MiB |
| Images per post | 4 |
| Alt text | 1 to 1000 characters, required |
| Pixels | 50 MP for JPEG, PNG, WebP and GIF; 16 MP for AVIF |
| Side | 16,383 pixels |
| Uploads, account younger than 24 hours | 20 per hour |
| Uploads, established account | 120 per hour |
| Uploads waiting to be attached | 20 per account |
| Processing | fails after 5 minutes |
| Unattached uploads | deleted after 24 hours |
| Free space | uploads are refused under 2 GiB free on either volume |
| Image requests | 1200 per minute per IP |

Upload limits are a new row in 2a's tier table and use its mechanism, so sub-project 3 replaces account age with reputation in one place. The free-space floor exists because the volumes share a disk with Postgres: filling the disk with images would stop the database.

## 7. Hardening

### 7.1 The container

`network_mode: none`, read-only root file system, user `node`, `cap_drop: [ALL]`, `no-new-privileges`, `mem_limit` and `memswap_limit` of 768 MB, one CPU, 64 processes, a 64 MB tmpfs at `/tmp` for libvips. It mounts the uploads read-only and the store read-write, and nothing else. It has no database URL, no Redis URL, no keys. Its health check reads the heartbeat file.

The image decoder is the most exploitable code korbat runs. If it is compromised, the attacker holds two directories, cannot call out, and cannot reach Postgres, Redis or the API.

### 7.2 The decoder

Section 2.3: magic bytes before any decoder, an allowlist of five loader classes, `VIPS_BLOCK_UNTRUSTED`, pixel caps from the header, one image at a time, a timeout per encode, a watchdog per upload, and at most three attempts per file.

`MEDIA_FORMATS` (default `jpeg,png,webp,gif,avif`) is read by the API and the worker. Removing a format refuses it at upload and leaves its loader blocked. When an advisory names a decoder, the operator edits one line and restarts two containers.

### 7.3 The store is untrusted

The API treats every file in the store as written by an attacker. It opens a file, and then checks the open handle: it must be a regular file, on the same device as the store directory, and within a size bound (16 KiB for a result, 32 MiB for an image). A symlink to anything outside the volume lands on another device and fails the check, and checking the handle leaves no window between check and use. Results are parsed with the protocol schema. A file that fails is answered with 404 and logged as a security event.

Image bytes are always sent as `image/webp` with `nosniff` and the API's `default-src 'none'` CSP, so bytes a compromised worker wrote cannot become active content.

### 7.4 Privacy

EXIF, GPS, ICC, XMP, IPTC, embedded thumbnails and gain maps do not survive. The original is deleted after processing and is never backed up. Nothing of the upload request is stored: not the file name (there is none in a raw body), not the declared type.

## 8. Errors

New codes in `MediaErrorCode`, in the standard envelope:

| Code | Status | When |
|---|---|---|
| `unsupported_media_type` | 415 | The declared type or the first bytes are not an enabled format. HEIC gets its own message: export as JPEG |
| `file_too_large` | 413 | More than 20 MiB |
| `too_many_pending_uploads` | 409 | 20 uploads wait to be attached |
| `uploads_unavailable` | 503 | Free space is under the floor |
| `media_unavailable` | 400 | Attaching an image that does not exist, is not yours, is not ready, or is already attached |

Reused: `invalid_request` (more than 4 images, a repeated id, missing or long alt text, a post without text and images), `rate_limited`, `not_found`, `unauthenticated`, `onboarding_required`, `csrf_failed`.

Failure reasons on a status response, not HTTP errors: `unsupported_format`, `animated_not_supported`, `image_too_large`, `corrupt_image`, `processing_failed`. The web app has a sentence for each.

## 9. Configuration and infrastructure

- **API**: `MEDIA_UPLOADS_DIR`, `MEDIA_STORE_DIR` (defaults under `.data/media/` at the repository root, for development on the host), `MEDIA_FORMATS`, `MEDIA_MIN_FREE_BYTES`.
- **Worker**: `MEDIA_UPLOADS_DIR`, `MEDIA_STORE_DIR`, `MEDIA_FORMATS`, `LOG_LEVEL`. `apps/worker/.env.example` is added and `gen-dev-env.mjs` handles it.
- **Compose**: `minio`, `minio-init`, their variables and the development ports 59000 and 59001 are removed. The `miniodata` volume is no longer declared; the volume on disk is left for its owner to delete, and the README says how. The API mounts the uploads read-write and the store read-only. The worker is set up as in 7.1 and no longer depends on Redis.
- **Images**: both Dockerfiles create `/media/uploads` and `/media/store` owned by `node`. The worker image installs inside Alpine and copies `sharp`, `@img`, `detect-libc` and `semver` next to the bundle, as the API image does for argon2.
- **Caddy**: `request_body` with `max_size 25MB` on `/api/media`, as a second line behind the API's own count.
- **Health**: `healthRoutes` takes advisory checks next to the critical ones. A failing advisory check reports `degraded` with status 200, so a stopped worker does not mark the API unhealthy and keep Caddy from starting. The worker is an advisory check.
- **Cloudflare**, recorded for Foundation Task 16 and sub-project 4: Browser Cache TTL "Respect Existing Headers". Without it browsers keep images for 4 hours whatever the origin says.
- **`.gitignore`**: `.data/`.

## 10. Web screens

Dependency: `expo-image`.

**Composer**

- "Add image" opens the browser's file picker, limited to the accepted types, several files at once, at most 4 in total. It is not shown on native.
- A file that is too large or of another type is refused before upload, with the reason.
- Each image shows a local preview at once (`URL.createObjectURL`, released on removal), its state (uploading, processing, ready, or the failure sentence), a description field with a counter, and Remove. Remove also calls `DELETE /api/media/:id`.
- The status is polled once a second until it is final.
- Post is enabled when there is text or an image, the text is within its limit, every image is ready, and every image has a description. The button says what is missing.

**Post card**

- One image: full width, its own ratio held between 3:4 and 2:1. Two to four images fill one 16:9 frame and crop to fill their cell: two side by side; three as one tall cell on the left and two stacked on the right; four as a two-by-two grid.
- Blurhash placeholders, lazy loading, the `small` size in lists.
- An ALT control shows the descriptions. `accessibilityLabel` carries each description to the `<img>`.
- A quoted post shows its images as one row of thumbnails.

**Viewer**

- Pressing an image opens it full screen: the `large` size fitted inside the screen, the description under it, previous and next, arrow keys, Escape. Focus returns to the image that opened it.

`lib/social.ts` gains `uploadMedia`, `mediaStatus` and `removeMedia`. Uploads send the CSRF header like every other write.

## 11. Test isolation

- `scripts/test-db.mjs` creates `korbat_test` in the Compose Postgres if it is missing, applies the per-database grants of `infra/postgres/init/01-roles.sh`, and runs the migrations with the migrate role. It can be run again at any time. Secrets are read from `infra/.env` and never printed.
- `gen-dev-env.mjs` writes `apps/api/.env.test` from `apps/api/.env` on every run: the same values, with the three database URLs pointing at `korbat_test` and the Redis URL at database 15. No second example file is kept.
- `vitest.integration.config.ts` loads `.env.test` itself and stops with instructions when the file is missing. Running `pnpm --filter @korbat/api test:integration` is enough; no file has to be sourced first.
- A global setup refuses to run unless both database names end in `_test` and the Redis database is 15. It then flushes that Redis database and truncates every table of the `public` and `auth` schemas.
- Media tests use temporary directories.
- `scripts/clean-dev-fixtures.mjs` lists what the tests left in the development database: profiles without an account behind them, and accounts whose email matches the tests' patterns. It deletes them only with `--yes`, and refuses to run unless `API_APP_ORIGIN` in `infra/.env` is a localhost origin.
- The smoke test deletes the post it made, which also exercises file deletion end to end.

## 12. Testing

- **`media-protocol`**: every accepted format by its bytes; HEIC brands, AVIF sequences and APNG detected; SVG, TIFF, PDF and ZIP refused; short buffers; path helpers refuse anything that is not a UUID; the result schema.
- **Worker**, with real sharp and fixtures made at test time:
  - each enabled format is processed, and SVG and TIFF are refused, which guards the allowlist against a silent typo;
  - a format removed from `MEDIA_FORMATS` is refused;
  - animated GIF, animated WebP and APNG are refused; 17 MP AVIF and 51 MP PNG are refused from the header; a truncated file is `corrupt_image`;
  - outputs are WebP of the right sizes, never enlarged, rotated by EXIF, without EXIF, GPS, ICC or the strings planted in the input, and without a ZIP appended to it;
  - Ultra HDR input is processed;
  - the third attempt fails the file without decoding; delete requests remove folder, result and counter; a result without an upload is removed; the heartbeat is written; names that are not UUIDs and entries that are not regular files are ignored.
- **API unit**: the byte counter stops a chunked body without a length at the limit; the sniff runs before anything is written; the safe open refuses a directory, an oversized file and a file on another device; `noStore` keeps a handler's header; advisory health checks.
- **API integration** against `korbat_test`, with a fake worker that writes results by the protocol: upload, status and finalize; every limit; attach rules (not yours, not ready, already attached, five images, no alt text, repeated id); a post with images and no text; a post with neither refused; images in timelines, threads, profiles and quotes; deleting a post removes rows and requests deletion; serving for visible, withheld, removed, deleted and unattached; `ETag` and 304; the sweeper's five jobs with a moved clock.
- **Architecture**: the rules in 2.6, each with a violation proven to fail.
- **Web**: typecheck and export; a scripted browser check of upload, description, post, grid, viewer and delete.
- **Docker**: the smoke test uploads a JPEG carrying GPS data through Caddy, waits for ready, posts it, and fetches `large.webp`: WebP bytes, the public cache header, no GPS. It then replaces that file with a symlink to `/proc/self/environ` from inside the worker container and expects 404 without any secret in the body. It deletes the post, expects 404, and checks that the folder is gone. It checks that the worker has only a loopback interface, that its memory limit is set, and that it never restarted.
- **Worst case**, in the dry run and after every sharp upgrade: the smoke test's `--worst-case` mode uploads flat-colour files at the caps (48 MP 16-bit interlaced PNG, 48 MP progressive JPEG, 48 MP GIF, 16 MP AVIF) and expects all ready, with `OOMKilled` false and no restart.

## 13. Dependencies

| Package | Where | Licence | Notes |
|---|---|---|---|
| `sharp` 0.35.4 | worker | Apache-2.0; prebuilt libvips LGPL-3.0-or-later | no install scripts; published 2026-08-26 |
| `blurhash` 2.0.5 | worker | MIT | no dependencies |
| `expo-image` 57.0.5 | app | MIT | the version Expo 57 expects; published 2026-09-11 |

Removed from the worker: `ioredis`, `@korbat/db`. All additions follow 1a's method: an exact version, the release-age override on that one command, and `check-lockfile-age.mjs` proving every new lockfile entry is at least 7 days old.

## 14. Effects on other documents and later work

- **Main design**: dated amendments record that volumes replace MinIO, that uploads stream through the API instead of signed URLs, that `post_media` has the shape of section 3, that NSFW scoring moves to row 3, and that the worker only processes images. Scheduled database jobs named there (the IP-hash purge of sub-project 4, the explore refresh of 2c) run in the API under a Redis lock, like the sweeper.
- **3b imports**: the quarantine bucket becomes a quarantine volume. Archives of up to 2 GB cannot pass Cloudflare's 100 MB request limit in one request, with or without MinIO, so 3b needs chunked uploads. Imported images enter this pipeline as uploads.
- **Sub-project 3**: scoring fills `nsfw_score` in the worker's slot; withholding already hides images from everyone but the author; CSAM scanning needs the cacheable URLs this slice provides; removal should purge the CDN.
- **Sub-project 4**: back up `media-store` with the database; tune Cloudflare as in section 9; check whether the Node binary in the image is position independent, as sharp's security page advises.
- **README**: new commands, the test database, and how to delete the old MinIO volume.

## 15. Success criteria

2b is done when:

1. A signed-in person can add up to four described images to a post, reply or quote on the web, and everyone who may see the post sees them in timelines, threads, profiles and quotes.
2. Stored images are fresh WebP encodes without metadata, and the original is gone, proven by the worker tests and the smoke test.
3. The worker runs without network, credentials or capabilities, refuses every format outside the allowlist, and survives the worst-case files within its memory limit without a restart.
4. A symlink planted in the store cannot make the API serve a file from outside the volume, proven on the built stack.
5. Images of withheld and removed posts reach only their author, and images of deleted posts are gone from disk.
6. Integration tests run only against `korbat_test`, and the development database gets no new fixtures.
7. The architecture test passes and fails on each deliberate violation.
8. Semgrep and the dependency audit stay clean, and the smoke test and the browser check pass on the built stack.

## 16. Amendments from the dry run (2026-09-19)

The plan was dry-run task by task in a scratch clone before the execution prompts were written, with every gate run by a script that required its expected output. Where the built system differs from sections 1 to 15, this section is the verified version.

### Schema and packages (sections 3 and 4)

| Spec | Built |
|---|---|
| One migration reshapes `post_media` | Two: `0005` drops `path` and makes post, position, width, height and blurhash optional; `0006` adds owner, status, failure reason, creation time, checks and indexes. drizzle-kit asks interactively when one migration both drops and adds columns, which a scripted run cannot answer |
| `@korbat/media-protocol` has no dependencies | It depends on `@korbat/contracts` for the size names and the failure reasons, so the worker's results and the API's responses share one list |
| The social repository owns its transactions | `createPost` and `deletePost` take a `within(tx)` callback, and `@korbat/db` exports the `DbTx` type; the media module attaches and detaches through the `MediaForPosts` interface, and the social module runs without images (`WITHOUT_MEDIA`) when none is wired |

### Worker (section 5)

- The small size and the blurhash come from one resize to raw pixels: the small WebP and the 32-pixel blurhash input are both made from that buffer, so the image is decoded twice (large, then small) rather than three times.
- In production the worker refuses to start without `VIPS_BLOCK_UNTRUSTED`; the image sets it, and a missing value means the image was changed.
- Ultra HDR has no fixture test. sharp 0.35.4 reports a gain map in its metadata but cannot write one, and the suites make every fixture at run time instead of committing binaries. The primary image of such a JPEG decodes like any JPEG, and every output is a fresh encode, so a gain map cannot survive.

### API (sections 6 to 8)

- Media ids are made lowercase by the contract (`MediaId`), and the file route checks the canonical form before it touches the disk. An id in capitals passed the UUID check and then made the volume layout throw, which answered 500.
- The social routes have their own error handler; it now maps `MediaError` like the app's. Without it, posting an image that was not ready answered 500.
- A deletion request stays for ten minutes after it is written (`DELETION_GRACE_MS`), so a slow worker cannot write files for an image whose request was already withdrawn.
- `noStore` sets `Cache-Control` only when the handler set none, so the file route's `public, max-age=300` survives.
- Caddy's upload limit applies to `/api/media` only, through an `@upload` path matcher inside `handle /api/*`.

### Development and stack (sections 9 and 11)

- The API and worker dev scripts run `tsx watch --env-file=.env`, so no shell has to source a file.
- The worst case on the built stack: the four files at the caps all became ready, and the worker's memory peaked at 383 and 385 MiB of its 768 MiB in two runs, without a restart or an OOM kill. The limit keeps about half in reserve.
- On Docker Desktop on this Windows machine, containers' outbound HTTPS is intermittently degraded: Turnstile verifications timed out at 5000 ms right after a heavy image build and, less often, at other times, and an image build's `pnpm install` failed with `ECONNRESET` while single requests got through. The API failed closed, as designed, and nothing in korbat changes for it. The smoke test tries a Turnstile refusal again every five seconds for up to a minute, where a wrong secret still fails, and the stack steps of the prompts say how to surface a build error their redirect hides.
- The smoke test makes its images with the sharp the worker depends on, resolved through `apps/worker/package.json`, and runs every container command with its standard input closed.

### Web (section 10)

- A HEIC photo is recognized by its name too, because browsers on Windows often give such a file no type; it gets the HEIC advice instead of the generic refusal.
- A quoted post's thumbnails are pictures, not buttons: the quote is one link to the quoted post, and a control inside a control is one that assistive technology cannot reach.
- The blurhash fades into the image in 150 ms, or at once when the system asks for reduced motion.
- The ALT control reports its state with `aria-expanded` and the Post button with `aria-busy`: react-native-web 0.21 ignores the `accessibilityState` prop, which the browser check caught on the ALT control. The older uses of `accessibilityState` in the app were fixed afterwards, in commit `1f5580a` (spec `2026-09-21-screen-reader-states-design.md`).
- The browser check covered sign-up, three uploads with their states, descriptions, the button naming what is missing, posting, the three-image grid, ALT, the viewer with arrow keys, Escape and focus return, an image-only post, and deletion down to the files on disk.
- A task step checks, in the installed source, the four library behaviours the grid and viewer rely on: expo-image puts `accessibilityLabel` into `<img alt>` and loads lazily by default; react-native-web's Modal closes on Escape and gives focus back when it closes.

### Test isolation (section 11)

- `scripts/clean-dev-fixtures.mjs` matches only emails of the tests' shape, `<word>-<uuid>@korbat.local`, and profiles without an account. Deleting profiles cascades to their rows, so the counters of kept profiles and posts those rows touched are recomputed from the rows in the same transaction. It prints the counts and up to 25 of each kind. The prompts run it without `--yes`; deletion was verified on seeded data in the scratch clone, where it also removed 117 accounts and 53 profiles that earlier test runs had left.

## 17. Amendments from the audit (2026-09-23)

Applied by `docs/superpowers/specs/2026-09-23-audit-fixes-design.md` (Tasks 5 and 6 of its prompts). Where this document and the audit design differ, the audit design is current.

- **Reconcile refuses large deletions (section 4.7).** The orphan pass refuses when the images without a row exceed 50 and 2% of the store, unless `MEDIA_RECONCILE=force`; `off` skips the pass for a restore window. A database restored from an older snapshot would otherwise lose every image posted since.
- **The store is never opened blocking (section 7.3).** Entries are inspected with `lstat` before they are opened, and opens are non-blocking, so a FIFO planted in the store cannot hold an API thread.
- **The sweeper is a job (section 4.7).** It runs on the API's job runner: one instance at a time, rounds never overlapping, the lock refreshed while a long reconcile runs.
- **Daily upload caps (section 6).** Besides 20 or 120 an hour, an account may upload 60 images a day in its first day and 500 a day afterwards.
````

### Replace `docs/superpowers/specs/2026-09-03-korbat-design.md` (whole file)

````markdown
# korbat — Design Spec

## Context

A pseudonymous social network where people can post opinions without a platform quietly removing them. Content limits are narrow and public: no sexual content (+18), no CSAM, no targeted racial hatred or harassment, no doxxing, no direct threats, no spam. Everything else stays up. Opinions are never a removal reason.

The credibility of the product rests on two things, which is why they get half the effort each:

- **Security.** Users who post unpopular opinions are targets. Account takeover, deanonymization, brigading, and admin compromise all have to be designed against from day one.
- **Transparent moderation.** Every removal cites a public rule, shows the author exactly what happened, and can be appealed to a different human. There is no silent reach reduction and the feed is chronological, so "shadowban" is not something the system can do.

Decisions made during brainstorming:

| Decision | Choice |
|---|---|
| Platform | Expo (React Native) codebase, web target first, iOS/Android via EAS later |
| Identity | Pseudonymous handles, email required at sign-up, optional verified badge |
| Content v1 | Text + images (video is v2) |
| Moderation | Public rulebook, human review with written reasons, appeals; automation only for +18 and CSAM detection |
| Scale | Solo/small team, first few thousand users |
| Backend | Fully self-owned: custom TypeScript API, own Postgres, own auth, own object storage. No managed backend vendor. Client never touches the database. |
| Auth | Hand-rolled flows and sessions in the API, built on audited primitives (argon2id, SimpleWebAuthn, otplib). No auth SaaS or auth framework. |
| Hosting | Docker Compose stack, runs on a cloud VPS now and moves to the user's local server later. Cloudflare Tunnel in front, so no inbound ports are ever opened. |
| Feed | Chronological following feed + explore tab |
| Threat priorities | All four: account takeover, deanonymization/leaks, bots/brigading/ban evasion, platform integrity |

The app is called **korbat**. The folder `C:\Users\Lenovo\Desktop\cool` currently holds two unrelated OSINT projects; korbat gets its own folder, `C:\Users\Lenovo\Desktop\cool\korbat`, as a fresh git repo.

---

## 1. Architecture

```
Browser / Expo app
        │  HTTPS (cookie session on web, bearer token on native)
        ▼
Cloudflare (DNS, WAF, DDoS, edge rate limits, CSAM scanning, Turnstile)
        │  Cloudflare Tunnel (outbound-only connection from the server; no open inbound ports)
        ▼
┌─ Docker Compose host (VPS now, local server later) ───────────────────────┐
│  cloudflared  ── tunnel client                                            │
│  caddy        ── internal reverse proxy, TLS termination inside the box   │
│  api          ── Hono on Node 22, TypeScript, Drizzle ORM                 │
│     ├── owns auth: sign-up, OTP, passwords, TOTP, passkeys, sessions      │
│     ├── enforces authz + rate limits, all reads/writes to Postgres        │
│     └── serves media by signed path from object storage                   │
│  worker       ── image pipeline: re-encode, strip EXIF, blurhash, NSFW   │
│  admin        ── moderation console, separate container + hostname       │
│  postgres 16  ── single source of truth, RLS on as defense in depth       │
│  redis        ── rate-limit counters, OTP/challenge state, job queue      │
│  minio        ── S3-compatible object storage for images (private bucket)│
│  mailer       ── outbound only (SMTP relay: Postmark/SES/self-hosted)     │
└───────────────────────────────────────────────────────────────────────────┘
```

**Monorepo** (pnpm workspaces):

```
apps/
  app/        Expo + expo-router, NativeWind, Reanimated. Web first.
  api/        Hono API, auth module, Drizzle schema + migrations, tests
  worker/     Image pipeline + scheduled jobs (IP-hash purge, explore refresh), consumes Redis queue
  admin/      Moderation console (Expo web or plain React). Separate deploy + hostname.
packages/
  contracts/  Zod schemas shared by app, admin, and api. Single source of truth for every request/response.
  rules/      The public rulebook as data (id, title, text, examples). Rendered in app and cited by moderation.
  db/         Drizzle schema + migrations, shared by api and worker.
infra/
  compose.yml, compose.prod.yml, Caddyfile, cloudflared config, backup script
```

**Why these pieces**

- **Hono**: tiny, TypeScript-native, middleware model makes security headers, auth, and rate limits composable. Runs anywhere Node runs, which is all a home server needs.
- **Drizzle**: typed schema and SQL migrations checked into git. No query builder magic that hides SQL, which matters for security review.
- **Own auth module** (section 3a): the user wants to own the backend end to end. We write the flows and session logic; cryptographic primitives come from audited libraries (`@node-rs/argon2` for argon2id, `@simplewebauthn/server` for passkeys, `otplib` for TOTP, Node `crypto` for random tokens and constant-time compares). Nothing else touches credentials.
- **Web sessions are httpOnly cookies set by the API**, never tokens in localStorage. This removes the most common XSS-to-account-takeover path on web. Native clients use bearer tokens in SecureStore.
- **MinIO** gives an S3-compatible API so image code is identical on a VPS, on a home server, and on real S3 if that's ever wanted. Bucket is private; the API issues short-lived signed GET URLs.
- **Cloudflare Tunnel** means the server makes an outbound connection and Cloudflare routes traffic in. No router port-forwarding, the home IP is never public, and WAF, DDoS absorption, Turnstile, and the free CSAM scanning tool still apply. Cloudflare Access can additionally gate the admin hostname behind its own login.
- **Same compose file everywhere**: develop on a laptop, run on a cheap VPS at launch, then `docker compose up` on the local server with a restored Postgres backup. Migration is a data move, not a re-architecture.

---

## 2. Data model (Postgres, Drizzle)

Only tables that v1 needs. PII (email, phone) lives in a separate `auth` schema that the public API role can only reach through a few security-definer functions, and is never joined into public responses.

**Auth schema (`auth.*`, owned by the auth module only)**
- `auth.users` — `id`, `email` (unique, citext), `email_verified_at`, `phone_hash` (for the verified badge; raw phone discarded after OTP), `password_hash` (argon2id, nullable when passkey-only), `totp_secret_enc` (encrypted at rest with a server key), `totp_enabled_at`, `recovery_codes_hash[]`, `failed_logins`, `locked_until`, `created_at`, `deleted_at`
- `auth.sessions` — `id` (random 256-bit, stored hashed), `user_id`, `device_id`, `created_at`, `expires_at` (30 days sliding, 12 months absolute), `last_used_at`, `revoked_at`, `reauth_at` (last fresh authentication, for sensitive actions)
- `auth.devices` — `user_id`, `device_hash`, `label`, `platform`, `first_seen_at`, `last_seen_at`, `ip_hash` (salted, 30-day purge), `revoked_at`
- `auth.email_codes` — `user_id` / `email`, `code_hash`, `purpose` (`signup`, `login`, `change_email`, `recovery`), `expires_at` (10 min), `attempts`, `consumed_at`
- `auth.passkeys` (auth phase 2) — `user_id`, `credential_id`, `public_key`, `counter`, `transports`, `backed_up`, `name`, `created_at`, `last_used_at`
- `auth.webauthn_challenges` — short-lived, in Redis rather than Postgres

**Identity (public schema)**
- `profiles` — `id` (= auth.users.id), `handle` (unique, immutable after 30 days), `display_name`, `bio`, `avatar_path`, `verified_at`, `reputation` (int), `created_at`, `deleted_at`

**Content**
- `posts` — `id`, `author_id`, `body` (≤ 1000 chars), `reply_to_id`, `quote_of_id`, `state` enum (`visible`, `withheld`, `removed`, `deleted_by_author`), `created_at`
- `post_media` — `post_id`, `path`, `width`, `height`, `blurhash`, `alt_text`, `nsfw_score`
- `follows`, `likes`, `reposts`, `bookmarks` — join tables with composite PKs
- `blocks`, `mutes` — user-level. Blocks are enforced in every read query, not just the UI.

**Trust & safety**
- `reports` — `reporter_id`, `target_type`, `target_id`, `rule_id` (from `packages/rules`), `details`, `weight` (from reporter reputation), `status`
- `cases` — one per moderation decision: `target`, `rule_id`, `action` enum (`none`, `withhold`, `remove`, `strike`, `suspend`), `public_reason` (shown to author), `moderator_id`, `created_at`
- `appeals` — `case_id`, `statement`, `status`, `reviewer_id` (must differ from original moderator), `decision_reason`
- `strikes` — `user_id`, `case_id`, `expires_at`
- `transparency_log` — anonymized public copy of every case: rule, action, date, whether appealed and outcome. Powers a public /transparency page.
- `audit_log` — append-only (no UPDATE/DELETE grants) record of every admin and moderator action.

**Feed queries**: following feed is `posts WHERE author_id IN (my follows) AND state = 'visible' AND author NOT IN (my blocks / blockers)`, keyset-paginated on `(created_at, id)`. Explore is a materialized view refreshed every few minutes ranking recent posts by engagement, same block filtering at read time.

---

## 3. Security design (threat by threat)

### 3a. Account takeover (own auth module, `apps/api/src/auth`)

The auth module is the single most reviewed code in the repo. It is one folder with one public interface, has no dependencies on the rest of the API, and every function in it has tests.

- **Sign-up**: email + 6-digit code (`auth.email_codes`, 10-minute expiry, 5 attempts, hashed at rest). Turnstile token verified server-side. Password optional at sign-up; if set, ≥ 12 chars and checked against the Have I Been Pwned range API (k-anonymity, only a 5-char SHA-1 prefix leaves the server). Hashed with argon2id (memory 64 MiB, iterations 3, parallelism 1; parameters stored alongside the hash for future upgrades).
- **Sign-in**: email code, or password. Constant-time comparison; identical response timing and message whether the email exists or not. After 5 failures the account locks for 15 minutes and the user gets an email.
- **MFA**: TOTP in v1 (`otplib`, secret encrypted with a server-side key from the secret store, 10 one-time recovery codes hashed). Passkeys in auth phase 2 with `@simplewebauthn/server`, then promoted as the default sign-in with password as fallback.
- **Sessions**: opaque 256-bit random ID; only its SHA-256 lives in `auth.sessions`. Web: httpOnly, Secure, SameSite=Lax cookie scoped to the API host, with a CSRF double-submit token for state-changing requests. Native: bearer token in SecureStore. Sliding 30-day expiry, 12-month absolute cap. Session ID is rotated on privilege changes (login, MFA enrol, password change).
- **Devices**: every session belongs to an `auth.devices` row. Users see their devices with platform, first/last seen, and can revoke one or all. First login from a new device sends an email alert with a one-click "this wasn't me" link that revokes it and forces a password reset.
- **Re-authentication**: handle change, email change, MFA removal, passkey removal, and account deletion require `reauth_at` within the last 5 minutes.
- **Rate limits**: per account, per email, and per IP/ASN sliding windows in Redis, with Cloudflare edge rules as the first layer on `/auth/*`.
- **Recovery**: email code to the verified address; if MFA is enabled, a recovery code is also required. No security questions, no SMS recovery (SIM-swap risk).
- **Explicit non-goals for v1**: OAuth social login (adds third-party trust and account-linking bugs), SMS login.

### 3b. Deanonymization and data leaks
- **PII minimization**: email and hashed phone exist only in `auth.users`. No API response type includes them except `/me`. Contracts in `packages/contracts` make this a compile-time property. The public API Postgres role has no SELECT on `auth.*`; the auth module uses its own role.
- **Images**: every upload is re-encoded with `sharp` (strips EXIF/GPS, defeats polyglot files), capped in pixel dimensions before decode (decompression-bomb guard), stored under a random ID, never the original filename. Uploads go through API-issued signed URLs with content-type and size constraints.
- **IP handling**: raw IPs never stored. Salted hash in `devices.ip_hash` for abuse correlation, purged by a 30-day job. Logs scrub tokens, emails, and IPs at the logger level.
- **No third-party trackers** in the client. Self-hosted, cookie-less analytics at most.
- **Defense in depth**: RLS enabled on every table even though only the API connects, so a SQL-injection or logic bug in one route cannot read another user's private rows. Three Postgres roles: `korbat_auth` (auth schema only), `korbat_api` (public schema, no DDL), `korbat_migrate` (DDL, used only by the migration job). MinIO bucket is private; media served through Cloudflare's CDN via short-lived signed URLs.
- **Encryption at rest**: Postgres and MinIO volumes on an encrypted disk (LUKS on the local server, provider-encrypted volume on the VPS). TOTP secrets additionally encrypted at the application layer. Backups encrypted with `age` before leaving the box.
- **User rights**: self-service data export (JSON) and account deletion (hard delete of profile/content, auth row anonymized) from v1.
- **Web hardening**: strict CSP with nonces, HSTS, `frame-ancestors 'none'`, CORS allowlist, `Referrer-Policy: no-referrer`.

### 3c. Bots, spam, brigading, ban evasion
- Sign-up friction: email verification, Cloudflare Turnstile, disposable-email domain blocklist, per-IP/ASN sign-up limits.
- New accounts: for the first 24 hours, max 5 posts/hour and 20 replies/hour; no reposts or quotes for 48 hours. Limits relax as `reputation` grows (established accounts: 30 posts/hour).
- Reputation: a simple score (account age, verified badge, upheld reports, strikes). Used to weight reports and to size rate limits. Never used to rank or hide content.
- Report weighting: reports from low-reputation or brand-new accounts count less. A spike of reports on one target from accounts that follow each other is flagged as **brigading** and protects the target (case goes to a senior queue) rather than triggering action.
- Ban evasion: hashed device fingerprint + email-domain heuristics at sign-up; matches surface to moderators as a signal, not an auto-ban.
- Every write endpoint has a per-user and per-IP rate limit declared next to the route.

### 3d. Platform integrity
- Cloudflare WAF managed rules, DDoS protection, and edge rate limits before traffic reaches the API.
- Every request body validated with the shared Zod contract before any handler runs. Drizzle parameterizes all SQL.
- Admin console on its own hostname and deploy. Admin/moderator accounts require TOTP (passkey once available). Every action lands in the append-only `audit_log`.
- Secrets in Docker secrets / a root-only `.env` on the host, never in the repo. `.env.example` only. Containers run as non-root with read-only root filesystems where possible; only Postgres, MinIO, and Redis get writable volumes.
- **Backups**: nightly `pg_dump` + MinIO mirror, encrypted with `age`, pushed off-box (cheap object storage or a second machine). Restore is rehearsed in sub-project 4 and is also the migration path from VPS to the local server.
- **Home-server specifics**: Cloudflare Tunnel is the only ingress; SSH only over Tailscale or the LAN; automatic OS security updates; UPS or at least a clean-shutdown script so Postgres never sees power loss mid-write.
- CI: typecheck, vitest, semgrep (OWASP ruleset), `pnpm audit`, Renovate for dependency updates, OWASP ZAP baseline scan against a preview deploy.
- Image processing runs in a separate worker process with memory and time limits so a malicious file can't take down the API.
- Structured logging with request IDs; alerts on auth-failure spikes, 5xx rate, and moderation queue age.

---

## 4. Content rules and moderation flow

### The rulebook (`packages/rules`)
Six rules, each with an ID, one-paragraph text, and two or three examples of what is and is not covered. Rendered in-app at `/rules` and cited by ID in every case.

| ID | Rule | Enforcement |
|---|---|---|
| R1 | No sexual or pornographic content | Automated image score → **withheld** pending human review. Human decides. |
| R2 | No child sexual abuse material | Cloudflare CSAM hash match → auto-remove, account suspended, NCMEC report. Only fully automated removal in the system. |
| R3 | No targeted hatred or harassment based on race, ethnicity, religion, or similar protected traits | Report-driven, human decision. Criticism of ideas, policies, groups' actions, or public figures is explicitly allowed. |
| R4 | No doxxing (publishing private info) | Report-driven, human. Withhold first when the report is credible, decide within SLA. |
| R5 | No direct threats of violence | Report-driven, human, senior queue. |
| R6 | No spam, scams, or impersonation | Report-driven, human. Reputation signals help triage. |

### What automation may and may not do
- **May**: score images for R1 and mark them `withheld`; hash-match for R2; raise priority on reports (e.g. many high-reputation reporters); flag brigading patterns.
- **May not**: remove text for any rule, reduce reach, hide from explore, or suspend an account (except R2).

### Case lifecycle
1. **Report** — reporter picks a rule, optionally adds context. Duplicate reports on the same target merge into one open case. Weight accumulates from reporter reputation.
2. **Queue** — moderators see cases sorted by weight and age. R2/R5 go to a senior queue. Brigading-flagged cases go to the senior queue with the target protected (no withholding on report volume alone).
3. **Decision** — moderator picks an action (`none`, `withhold`, `remove`, `strike`, `suspend`) and must write a `public_reason` citing the rule. The author sees the exact content that was actioned, the rule, the reason, and an **Appeal** button. Strikes expire after 90 days; suspension requires 3 active strikes or an R2/R5 case.
4. **Appeal** — one appeal per case, free-text statement. Reviewed by a different moderator. Outcome and reason are shown to the author. Upheld appeals reverse the action and remove the strike.
5. **Transparency** — every closed case is copied to `transparency_log` without user identifiers. Public `/transparency` page shows monthly counts per rule, per action, appeal rate, and reversal rate.

### What the author experiences
- A withheld post shows to the author as "Under review for R1, usually within 24h" with the content still visible to them. Nobody else sees it.
- A removed post stays in the author's view with a red status chip and the reason. It is never silently gone.
- Suspension shows the case list and a link to appeal each one.

---

## 5. UI direction

The security and transparency story must be *visible* in the UI, not buried in settings. The frontend-design skill will be used at implementation time; this is the brief it gets.

- **Stack**: Expo + expo-router (file routes work on web and native), NativeWind for styling, Reanimated for motion, `expo-image` with blurhash placeholders.
- **Layout**: desktop web is three columns (nav / timeline / context panel with explore and transparency stats). Tablet collapses the context panel. Phone is a single column with a bottom tab bar and a floating compose button. Same components across breakpoints.
- **Look**: dark-first with a light theme, high-contrast editorial type (one display face for handles and headings, one text face), generous line height, restrained color. One accent for actions, and a fixed semantic set for status chips: under review (amber), removed (red), verified (blue). Avoid generic AI-looking gradients and glassmorphism.
- **Composer**: bottom sheet on phone, inline card on desktop. Character counter, image picker with alt-text prompt, live warning if the image scores near the R1 threshold *before* posting.
- **Transparency surfaces**: status chips on posts; "Your cases" screen; public `/rules` and `/transparency`; security screen listing devices, MFA state, and recent sign-ins with a one-tap "revoke all".
- **Accessibility**: WCAG AA contrast, reduced-motion respected, all images require or auto-suggest alt text, full keyboard navigation on web.
- **Motion**: small and purposeful. Sheet spring, like/repost micro-feedback, timeline insert of new posts. Nothing decorative.

---

## 6. Decomposition and build order

Each sub-project gets its own spec → plan → implementation cycle. Order chosen so every step ships something testable and the security floor exists before user content does.

| # | Sub-project | Delivers | Depends on |
|---|---|---|---|
| 0 | **Foundation** | Monorepo scaffold, `packages/contracts`, `packages/rules`, `packages/db` with Drizzle schema + migrations + the three Postgres roles, `infra/` Docker Compose (postgres, redis, minio, caddy, api, worker, cloudflared), Hono skeleton with security headers, CI (typecheck, vitest, semgrep, audit), hello-world reachable through a Cloudflare Tunnel | — |
| 1 | **Identity & auth** | Split into 1a core accounts and sessions (sign-up with email code and 16+ age check, optional password + HIBP, argon2id, lockout, TOTP MFA + recovery codes, cookie + CSRF / bearer sessions, devices, "wasn't me" link, re-auth, staff MFA; spec `2026-09-14-identity-auth-1a-design.md`), 1b account lifecycle (profile + handle changes, verified badge, data export, account deletion), 1c passkeys. | 0 |
| 2 | **Posting & feed** | Split into 2a text posting and feed (posts, replies, quotes, likes, reposts, bookmarks, follows, blocks/mutes, Following and Latest timelines, threads, profile pages, write limits, web screens; spec `2026-09-17-posting-feed-2a-design.md`), 2b images (upload, worker re-encode, EXIF strip, blurhash, alt text, media in composer and lists; spec `2026-09-18-images-2b-design.md`), 2c explore (ranked view, refresh job, tab). | 1a |
| 3 | **Trust & safety** | Report flow, case queue, decisions with public reasons, strikes, appeals, transparency log + page, brigading detection, author-facing case screens, admin console with MFA + audit log, CSAM scanning hookup, NSFW image scoring with automatic withholding for R1 (moved here from 2b on 2026-09-18, so that no post is withheld before a human can review it) | 2 |
| 3b | **Import from other platforms** | Archive upload for X, Mastodon, Bluesky; quarantine bucket; sandboxed streaming parser; preview and select; imported posts on profile only; same image pipeline and CSAM scan as native posts; one-click undo. See section 6a. | 2, 3 |
| 4 | **Hardening & launch** | Cloudflare WAF/rate rules tuned, ZAP scan clean, dependency audit clean, log scrubbing verified, IP-hash purge job, alerting, backup/restore drill, privacy policy + terms, external pen-test checklist walked | 3, 3b |
| 5 | **Native builds** | EAS builds for iOS/Android, SecureStore sessions, push notifications, store listings | 4 |

Sub-project 0 is small and will be planned immediately after this design is approved. Each later one starts with a short brainstorm to confirm details that this document leaves at the level of intent.

---

## 6a. Importing posts from other platforms (added 2026-09-14)

Users can bring their post history with them. The feature is opt-in, owner-driven, and treated as untrusted bulk input.

**How a user imports**
1. The user downloads their own official data export from the other platform: X "Download an archive of your data", a Mastodon account archive, or a Bluesky repository export (`.car`). Meta (Threads/Instagram/Facebook) and Reddit exports come later as extra adapters.
2. They upload that file on korbat's import screen. korbat never asks for another platform's password, never scrapes, and does not fetch posts by handle. Fetching by handle would let anyone import someone else's posts, which is impersonation.
3. korbat parses the archive in the worker and shows a preview: post count, date range, image count, and what will be skipped. The user picks everything, a date range, and whether to include replies.
4. Nothing is published until the user confirms. The import can be undone later in one action, which deletes every post from that import.

**Security controls**
- **Quarantine**: archives upload through a short-lived signed URL into a separate private `korbat-imports` bucket, never the media bucket. Size cap 2 GB. The archive is deleted as soon as parsing finishes, or after 24 hours if the user abandons the preview.
- **Sandboxed parsing** in the worker with its own memory and time limits: streaming unzip, reject path traversal, absolute paths and symlinks, cap entry count and total uncompressed size (zip-bomb guard), and read only an allowlist of known file paths per source. X's `tweets.js` is stripped of its `window.YTD...=` prefix and parsed as JSON, never evaluated.
- **Data minimisation**: archives contain DMs, IP logs, phone numbers, contacts and ad data. Only the allowlisted post and media files are opened. Nothing else is read, stored or logged.
- **Same rules as native posts**: every imported image goes through the normal pipeline (re-encode, EXIF strip, NSFW score, CSAM hash). An R1 score withholds that post for human review. A CSAM match aborts the whole import and follows the R2 process. Text is never auto-removed; it can be reported like any post.
- **Anti-abuse**: email-verified accounts only, one active import per user, at most 50,000 posts per import, worker concurrency capped so imports cannot starve normal traffic.
- **Provenance label**: every imported post shows "Imported from X · original date". An optional ownership check (put a one-time korbat code in the source profile's bio) adds a "verified import" mark, which helps against people importing archives that are not theirs.

**Product behaviour**
- Imported posts appear on the author's profile in original date order. They do not enter followers' chronological feeds or explore, so a 10,000-post import cannot flood anyone's timeline.
- @mentions and links stay as plain text. korbat does not map other platforms' users to korbat accounts, so it never implies someone is on korbat.
- Reposts of other people's content are skipped. Threads of the user's own posts are kept as threads.

**Designed for expansion**
- Each source is an adapter with two functions: `detect(entries)` recognises the archive, and `readPosts(stream)` yields a normalised `ImportedPost` defined in `packages/contracts`. Adding Threads or Reddit is a new adapter; the pipeline, preview and moderation path do not change.
- Schema is added by migration in this sub-project: an `import_jobs` table (owner, source, status, stats, timestamps) and nullable columns on `posts` (`import_job_id`, `source`, `original_created_at`, `original_url`). These are additive, so the Foundation schema does not need to anticipate them.

---

## 7. Testing and verification

- **Unit** (vitest, `apps/api`): contracts, rate-limit logic, reputation and report weighting, feed query builders, image pipeline (assert EXIF gone, dimensions capped, output is a fresh encode).
- **Auth module tests** (highest coverage bar in the repo): every flow in section 3a, including negative cases: expired codes, attempt exhaustion, lockout timing, session hash never equals the raw ID, CSRF token rejection, re-auth window expiry, recovery with and without MFA, constant-time behavior for unknown vs. known emails (timing assertion with tolerance).
- **Integration**: API against the Docker Compose stack (`docker compose -f infra/compose.yml up -d postgres redis minio`). Covers session cookie behavior, block enforcement in feed queries, case lifecycle including appeal-by-different-moderator rule, audit-log immutability (UPDATE/DELETE must fail), signed media URL expiry.
- **RLS and role tests**: run each table's policies as `korbat_api` and confirm it cannot SELECT from `auth.*`, cannot run DDL, and cannot bypass block filtering.
- **E2E** (Playwright on the Expo web build): sign-up → MFA → post with image → report → moderator decision → author sees reason → appeal → reversal.
- **Security checks in CI**: semgrep OWASP ruleset, `pnpm audit` at high severity, ZAP baseline scan against the preview URL, CSP header assertion test, rate-limit smoke test (burst must 429).
- **Manual pre-launch**: OWASP ASVS level 2 checklist walk-through, sensitive-action re-auth spot checks, "revoke all devices" actually invalidates sessions, deleted account leaves no public trace.

Every sub-project's plan will include its own slice of this list as acceptance criteria.

---

## 8. Immediate next steps on approval

1. Save this design as the spec at `C:\Users\Lenovo\Desktop\cool\korbat\docs\superpowers\specs\2026-09-03-korbat-design.md` in the new repo and commit it.
2. Run the writing-plans skill to produce the detailed implementation plan for **sub-project 0 (Foundation)**. Its scope:
   - `pnpm` monorepo at `C:\Users\Lenovo\Desktop\cool\korbat` with `apps/app` (Expo, expo-router, NativeWind, web target), `apps/api` (Hono, vitest), `apps/worker` (queue consumer skeleton), `apps/admin` (placeholder), `packages/contracts` (Zod), `packages/rules` (the six rules as data), `packages/db` (Drizzle schema + migrations).
   - `infra/compose.yml`: postgres 16, redis, minio, caddy, api, worker, cloudflared, all non-root; `infra/compose.dev.yml` override that skips cloudflared and exposes localhost ports. Init SQL that creates the `auth` schema and the three roles (`korbat_auth`, `korbat_api`, `korbat_migrate`).
   - Drizzle schema for every table in section 2, initial migration run by a one-shot `migrate` service using `korbat_migrate`, RLS enabled on all public tables.
   - Hono skeleton: security-headers middleware (CSP, HSTS, frame-ancestors, referrer policy), request-ID logging with PII scrubbing, Zod validation middleware, Redis rate-limit middleware, health endpoint, and a stub session middleware that sub-project 1 replaces with the real auth module.
   - CI (GitHub Actions): typecheck, vitest, semgrep OWASP ruleset, `pnpm audit --audit-level high`, `docker compose config` validation, Renovate config.
   - `.env.example` for every app and for `infra/`; secrets never committed.
   - Done when `docker compose up` on a laptop serves the health endpoint and the Expo web shell, and the same stack is reachable through a Cloudflare Tunnel on a throwaway subdomain.
3. Sub-projects 1 to 5 each get a short brainstorm to confirm details, then their own plan, in the order in section 6.

## 9. Amendments

### 2026-09-18, from the 2b images design (`2026-09-18-images-2b-design.md`)

- **Object storage.** MinIO's community edition was archived upstream in 2026 and gets no security fixes. korbat keeps images in two Docker volumes behind a small file protocol between the API and the worker. Wherever this document says MinIO, bucket or signed URL, read: volumes, and uploads and downloads streamed through the API. The storage interface leaves room for an S3 adapter.
- **The worker** only processes images. It has no network, no database or Redis credentials and no capabilities. Scheduled database jobs named in this document (the IP-hash purge, the explore refresh) run in the API under a Redis lock.
- **NSFW scoring** and the automatic withholding for R1 move from row 2 to row 3 of the build order, together with the composer warning in section 5.
- **`post_media`** has the shape of section 3 of the 2b design: an owner, a status, optional post and position until the image is attached, and no `path` column.
- **Media serving.** Images of visible posts are public and cacheable for five minutes at URLs ending in `.webp`, which is what Cloudflare's cache and its CSAM scanning tool need. Images of withheld and removed posts reach only their author and are never cached. The Cloudflare zone must use Browser Cache TTL "Respect Existing Headers".
- **Backups** (section 3d) cover the `media-store` volume instead of a MinIO mirror.
- **Imports (section 6a).** The quarantine bucket becomes a quarantine volume. Archives of up to 2 GB cannot pass Cloudflare's 100 MB request limit in one request, so imports need chunked uploads.

### 2026-09-23, from the audit (`2026-09-23-audit-fixes-design.md`)

Four read-only reviews (auth, image pipeline and deployment, social module, web client) and a dependency check were run on the repository at `f0c9799` before work continued. The audit design records every finding and its fix. What changes in this document's terms:

- **Technologies (section 1).** TypeScript 7 (the native compiler) for the API, worker and packages, TypeScript 6.0 for the Expo app; esbuild called directly instead of tsup; ioredis 6; **Valkey 9.1 (BSD-3) instead of Redis** (the service keeps the name `redis`, on a new volume `valkeydata`, because Valkey 9 cannot read Redis 7.4's RDB format 12 and the old volume held only transient state); **PostgreSQL 18** on a new volume, with `scripts/pg-major-upgrade.mjs` moving a database from the 16 volume; Caddy as its own user on port 8080; cloudflared, Caddy, the API and the data services on separate networks; every image pinned by digest, pnpm installed through corepack from its hash.
- **Retention (section 3b).** The IP-hash purge and the retention of codes, sessions and security events run in the API every ten minutes (audit design, section 5).
- **Method (section 6).** Sub-projects are still dry-run task by task in a scratch clone with a gated runner and turned into verified prompts; from this batch on the prompts are replayed into the repository by a deterministic script (`replay.py` in the scratch tooling) instead of a fresh model session per prompt. The proof is unchanged: every gate passes in the repository, every written file is byte-identical to the dry run, and `verify_prompts.py` reproduces the repository. The scratch clone lives at `C:/Users/Lenovo/Desktop/cool/korbat-scratch/` (throwaway), outside the temp folder Windows Storage Sense prunes.
- **Status and order (section 6).** Done: 0 (except Task 16, the tunnel), 1a, 2a, 2b, the screen-reader fix, this audit batch. Next, in order: 1b account lifecycle (profile and handle changes, verified badge behind a provider interface, data export, account deletion), 1c passkeys, 2c explore, 3 trust and safety (with NSFW scoring), 3b import, 4 hardening (owner-scoped RLS, backups and alerting, ZAP, policy texts), 5 native builds. The steps that need the user's own accounts come last and are written up as runbooks: the Cloudflare Tunnel, WAF and CSAM tool (Foundation Task 16 and sub-project 4), the EU mail relay, a verification provider for the badge, and the Expo, Apple and Google accounts for sub-project 5.
````

### Replace `docs/superpowers/specs/2026-09-23-audit-fixes-design.md` (whole file)

```markdown
# korbat audit fixes (2026-09-23) — design

## Context

On 2026-09-23 the repository at `f0c9799` was audited before work continued past sub-project 2b: four independent read-only reviews (auth module; image pipeline and deployment; social module; web client), a dependency-currency check against the npm registry and Docker Hub, and `pnpm audit`. This document records what the audit found, which technologies change, and how each defect is fixed. It is the spec for one batch of tasks that precedes sub-projects 1b, 1c, 2c, 3, 3b, 4 and 5.

The user asked for the audit, for better technologies or libraries where they exist, for logic and security fixes where needed, and for the work to continue without pauses for approval. Decisions below are therefore taken here and recorded; nothing in this batch changes a product decision from an earlier spec.

## Decisions

- **Method.** Every task is still dry-run in a scratch clone with the gated runner, and the prompts under `docs/superpowers/prompts/audit-fixes/` are still generated from the verified commits. What changes: the prompts are replayed into the real repository by a deterministic script (`replay.py`: `write_blocks.py` for every writing step, every verification gate, the commit) instead of a fresh model session per prompt. The proof is the same as before (every gate passes in the real repository, every written file is byte-identical to the dry run, `verify_prompts.py` reproduces the repository); only the transcription step no longer costs a model session. The scratch clone moved from `%TEMP%`, which Windows Storage Sense prunes, to `C:/Users/Lenovo/Desktop/cool/korbat-scratch/repo` (tooling in `../tools`); it is throwaway.
- **TypeScript 7.0.2** for the API, worker and packages (the native compiler; every package type-checks unchanged, tested 2026-09-23). **TypeScript 6.0.3** for the Expo app, the version Expo SDK 57 expects; TypeScript 7 rejects the app (`types` defaults to `[]` and `noUncheckedSideEffectImports` fails the `global.css` import).
- **esbuild 0.28.2, called directly**, replaces tsup 8.5.1 (in maintenance mode; pins esbuild 0.27.7 with an open advisory and the only `chokidar@4.0.3` in the lockfile, one of the three trust-policy exclusions). A 20-line build script per app reproduces tsup's configuration. tsdown (0.23) stays out until it is 1.x.
- **ioredis 6.0.0** (RESP3 by default; Node 20+). korbat's Redis surface is `GET`, `SET PX [NX]`, `GETDEL`, `DEL`, `PING` and two Lua scripts returning integers, all identical under RESP3.
- **Valkey 9.1 (BSD-3)** replaces `redis:7-alpine` (7.4 is RSALv2/SSPLv1; Redis 8 is AGPL, which the project keeps out). Drop-in for ioredis. A password is required from now on.
- **PostgreSQL 18** replaces 16 while the data is small: supported until 2030, checksums on by default, and the major-version move is a rehearsed dump-and-restore script instead of a task for launch day. The official image mounts the volume at `/var/lib/postgresql` from 18 on, so the volume is new (`pgdata18`); the old `pgdata` volume is left untouched.
- **Images pinned**: Postgres, Valkey, Caddy, Mailpit, cloudflared (`2026.9.1`, never `latest`) and semgrep (`1.177.0`) by version, with Renovate's `docker:pinDigests` preset so Renovate adds and bumps digests. pnpm is installed in the Docker images through corepack from the hashed `packageManager` field, not `npm install -g`.
- **Small version refresh** (all at least 7 days old today): hono 4.13.8, zod 4.6.5, `@node-rs/argon2` 2.2.1, nodemailer 10.0.10 (ships its own types; `@types/nodemailer`, a 6.x definition against a 10.x library, goes), `@types/node` 24.13.5, expo 57.0.23, nativewind 4.2.7. Not bumped: React 19.3, react-native 0.87, gesture-handler 3, reanimated 4.7 and expo-router/expo-constants patches (Expo SDK 57 pins or too young), Tailwind 4 with NativeWind 5 (release candidate), vitest 5 (nothing needed), drizzle 0.45.3 / drizzle-kit 0.31.11 (two days old).
- **`query-string` overridden to 9.5.1** (which pulls `decode-uri-component` 0.5.0) if, and only if, the dry run proves expo-router's exported web bundle still parses and prints query strings; this clears the one `pnpm audit` advisory that reaches shipped client code (exponential-time decoding of a malformed link). The two build-time advisories (`esbuild` 0.18 under drizzle-kit's loader, `uuid` 7 under Expo's Xcode plugin) are recorded, not overridden.
- **Defects are fixed by module**, each with a failing test first, in the task order of section 1. No product decision from 1a, 2a or 2b changes; where a fix touches behaviour a spec described (blocks retracting reposts, fresh authentication for enrolling two-factor), the earlier spec is amended by this one.

## Research (verified 2026-09-23)

| Finding | Consequence |
|---|---|
| `npx tsc` from `typescript@7.0.2` exits 0 on `apps/api`, `apps/worker` and every package with the current tsconfigs; on `apps/app` it reports missing Node types and the CSS side-effect import | TS 7 for the server side, TS 6.0.3 for the app |
| `typescript@6.0.3` is what `expo install --check` expects for SDK 57 | as above |
| `chokidar@4.0.3` is required only by `tsup@8.5.1` (`pnpm-lock.yaml`); `tsx` depends on esbuild alone | dropping tsup removes the exclusion |
| ioredis 6.0.0 release notes: Node 20+, RESP3 default, `protocol: 2` opt-out | upgrade; integration tests are the proof |
| Caddy `reverse_proxy` ignores incoming `X-Forwarded-*` from untrusted peers (docs) | behind Caddy, the first `X-Forwarded-For` entry is Caddy's view of the client |
| `node:24-alpine` is Node 24.21 with corepack 0.36 | corepack installs pnpm from the hashed field |
| Postgres image docs: from 18 `PGDATA` is `/var/lib/postgresql/18/docker`, the volume mount is `/var/lib/postgresql`, chosen for `pg_upgrade --link` | new volume, upgrade script |
| Valkey releases: 9.1.2 (2026-09-01) stable, 9.2 is a release candidate | `valkey/valkey:9.1-alpine` |
| `pnpm audit`: 4 advisories (1 low, 3 moderate), none in server runtime code; one (`decode-uri-component` 0.2.2 via expo-router → `query-string` 7.1.3) is in the web bundle; `query-string@9.5.1` (ESM) depends on `decode-uri-component ^0.5.0`; expo-router calls only `parse` and `stringify` | override attempted in Task 1 |
| `.npmrc` `min-release-age=7` is not a pnpm option (`pnpm config` lists it beside the real `minimum-release-age=10080` from the workspace file) | the dead line is removed |

## 1. Scope

Nine tasks, one commit each:

1. Dependencies: the versions above, TypeScript 7/6, ioredis 6, the `query-string` override (kept only if proven), `expo-status-bar` removed (unused).
2. Build: esbuild scripts replace tsup in `apps/api` and `apps/worker`; the chokidar exclusion leaves `pnpm-workspace.yaml`; the dead `.npmrc` line goes.
3. Auth hardening (findings A2, A3, A5, A7, A8, A9, A10, A11).
4. Request identity, configuration guards, body limits, logging (A1/M4, A4, A6/M6, M3).
5. Background jobs, retention and media safety (M1, M2, M10, A11 retention, the design's IP-hash purge).
6. Social fixes and indexes (S1–S10, M8, index observations).
7. Web client (W1–W13, W15, W16, the Settings highlight).
8. Infrastructure (M5, M7, M9, M11, M12, M14, W2, W14; Postgres 18, Valkey, pinned images, corepack, networks, limits, log rotation, CI).
9. Documentation: README, spec amendments, the roadmap note in the main design.

Out of scope, deferred with reasons in section 10: owner-scoped RLS, backups and alerting, a nonce CSP, NativeWind 5, Expo SDK 58, dropping reanimated from the web bundle, the light theme.

## 2. Dependencies and build (Tasks 1 and 2)

**Task 1** edits every `package.json` and runs one non-frozen install (`--config.minimum-release-age=0` for that command, then `scripts/check-lockfile-age.mjs --base HEAD` proves nothing younger than 7 days was locked). `@types/nodemailer` is removed; `apps/api/src/mail/smtp.ts` compiles against nodemailer's own types or gets the smallest type annotation that makes it. The root `package.json` gains `pnpm.overrides` `{ "query-string": "9.5.1" }` and a vitest in `apps/app/test/query-string.test.ts` asserting that `query-string` (as expo-router requires it: `parse`, `stringify` with `{ sort: false }`) round-trips `a=%2F&b=1` and that the lockfile holds no `decode-uri-component` below 0.5.0. The web export must succeed with the override, and the scratch browser check opens a route with a query string. If any of that fails, the override and the test are dropped from the task and the README records the advisory as accepted.

**Task 2** adds `apps/api/build.mjs` and `apps/worker/build.mjs`: `esbuild.build` with the same entry points, `format: "esm"`, `platform: "node"`, `target: "node24"`, `bundle: true`, `sourcemap: true`, the `createRequire` banner, `external: ["@node-rs/argon2"]` (API) and `["sharp", "@img/*"]` (worker), `packages: "bundle"` for everything else, and `outdir: "dist"` emptied first. The `build` scripts call them; tsup leaves both `devDependencies`, `esbuild` 0.28.2 enters. Gates: both builds, the built API answers `/api/health` from `node dist/index.js`, `node dist/migrate.js` reports nothing to apply, the worker's built bundle starts and writes a heartbeat. `pnpm-workspace.yaml` loses the `chokidar@4.0.3` line and its comment mentions two exclusions; `.npmrc` keeps only `node-linker=hoisted`.

## 3. Auth hardening (Task 3)

- **A2, fresh authentication for two-factor enrolment.** `POST /api/auth/mfa/totp/setup`, `/confirm` and `DELETE /api/auth/sessions/:id` require `fresh` (a re-authentication within 5 minutes) whether or not two-factor is already on. Signing in counts as fresh, so the usual enrol-right-after-sign-up path costs nothing. Amends 1a section 5.3.
- **A9, owners hear about security changes.** New mail templates `mfa_enabled`, `mfa_disabled`, `password_changed`, `recovery_codes_regenerated`, `sessions_revoked_all`, sent best-effort like the new-device alert. The "this wasn't me" token carries the device id; acting on it also sets `devices.revoked_at` for that device, so its next sign-in is a new device again.
- **A5, malformed JSON is a 400.** Hono's `HTTPException` maps to `invalid_request` with the exception's status in both error handlers (auth router and app).
- **A7, flow ids hashed.** `signup:` and `flow:` keys use `sha256Hex(id)` like sessions and tickets.
- **A8, the two spec'd limits.** `signup/complete` 10 per IP per hour, `onboarding/handle` 10 per session per hour, through `enforceLimit`. Every `enforceLimit` refusal carries `Retry-After`.
- **A10, platform is not self-declared on the web.** A request that carries `Sec-Fetch-Mode` or `Origin` is treated as `platform: "web"` regardless of the body, so a script on the app origin can never obtain a bearer token.
- **A3, revocation beats the cache.** `revoke` writes a `revoked` tombstone under the session cache key for the cache TTL instead of deleting it; `resolve` fills the cache with `setIfAbsent` and treats the tombstone as no session. `disableTotp` and `confirmTotp` delete the cache entry so `mfaEnabled` is never stale.
- **A11 pieces.** Rehash-on-login: `verifyPassword` reports `needsRehash` and `password/signin` re-hashes with the current parameters. `TOTP_ENC_KEYS_PREVIOUS` (comma-separated, optional) is accepted for decryption; a secret decrypted with a previous key is re-encrypted with the current one on read. The age check answers after the rate limits, not before. Dead helpers (`consumeRecoveryCode`, `recentEvents`) go.

## 4. Request identity, configuration guards, body limits, logging (Task 4)

- **A1/M4, explicit proxy trust.** New config `TRUST_PROXY: cloudflare | caddy | none`, required in production (`API_TRUST_PROXY` in `infra/.env`, no default in compose). `cloudflare`: `cf-connecting-ip`, falling back to the first `X-Forwarded-For` entry, then the socket address. `caddy`: the first `X-Forwarded-For` entry (Caddy replaces client-sent values), then the socket. `none`: the socket address only. `clientIp` takes the config; a unit test proves a spoofed `cf-connecting-ip` opens no bucket in `caddy` and `none` modes. Development and the integration tests use `cloudflare` (the test client identifies itself with that header). The Caddyfile deletes `CF-Connecting-IP` from requests when it is not behind the tunnel (Task 8 owns the file; the API change lands here).
- **Rate-limit keys never hold a raw address.** The global limiter and every per-IP auth limit key an HMAC of the address (`IP_HASH_KEY`, the existing `hashIp`), truncated to 24 hex characters.
- **A6/M6, production refuses development values.** With `NODE_ENV=production`: Cloudflare's documented Turnstile test secrets (`1x…`, `2x…`, `3x…`) are refused, `APP_ORIGIN` must be `https:`, every `TRUSTED_ORIGINS` entry must be `https:`, and `SMTP_URL` must be `smtps:` or the SMTP adapter is built with `requireTLS: true`. The web image build refuses the always-pass site key when `KORBAT_ENV=production` is passed.
- **M3, JSON bodies capped.** Hono's `bodyLimit` at 64 KiB on every route except `POST /api/media`; the Caddyfile mirrors it (Task 8). A too-large body is `413 payload_too_large`.
- **A4, error stacks scrubbed.** The logger scrubs `stack` with the same function as `message`; a logger test passes an `Error` whose message holds an email and an IP.

## 5. Background jobs, retention and media safety (Task 5)

- **A small job runner** (`apps/api/src/lib/jobs.ts`): `startJob({ name, intervalMs, lockTtlMs, run })` chains `setTimeout` after each round (never overlapping), takes the Redis lock `job:<name>` with a random token, refreshes it every `lockTtlMs / 2` while `run` is in flight, and releases it with a compare-and-delete script. Both existing lock uses move onto it: the media sweeper (fixes M10) and the new auth janitor. The in-memory lock stays for unit tests.
- **Auth janitor** every 10 minutes: deletes `email_codes` consumed or expired more than 24 hours ago; deletes `sessions` revoked or expired more than 30 days ago; nulls `devices.ip_hash` where `last_seen_at` is older than 30 days (the design's IP-hash purge, section 3b); deletes `auth_events` older than 90 days through a security-definer function `auth.purge_events(older_than interval)` added by migration, owned by `korbat_migrate` and executable by `korbat_auth`, so the table stays append-only for the API role. Amends 1a section 1 (the purge job was out of scope there).
- **M1, reconcile refuses to delete a lot.** The sweeper's orphan pass logs and skips deletion when the orphans exceed 50 and 2% of stored images, unless `MEDIA_RECONCILE=force`; `MEDIA_RECONCILE=off` skips the pass. The README's restore section says: restore the database and `media-store` from the same snapshot with the sweeper off, then turn it on.
- **M2, no blocking opens.** `READ_FLAGS` gains `O_NONBLOCK` and the read path `lstat`s the entry and refuses anything but a regular file before opening it; a test plants a FIFO (where the platform allows) and expects a refusal within the timeout.

## 6. Social fixes and indexes (Task 6)

- **S1.** Post rows carry the parent's author id and state; `replyTo.authorHandle` is null when the viewer may not see that author (block either way) or the parent is not shown. Contract: `replyTo.authorHandle` becomes nullable. The web shows "Replying to a post you can't see" then.
- **S2 and S10.** `block()` also deletes, both ways, the pair's reposts and likes of each other's posts, adjusting counters by affected rows in the same transaction (amends 2a section 5.3: unblocking restores nothing). Undo actions (`on: false`) never consult the block relation.
- **S3.** Pair-scoped advisory locks: `pg_advisory_xact_lock(hashtext(least(a, b)), hashtext(greatest(a, b)))` taken inside the transaction of `follow`, `block`, `like`, `repost`, reply and quote creation, and the block check for those writes moves inside the same transaction, so a write cannot land across a concurrent block.
- **S4.** Cursor `t` is capped at `8640000000000000`; any other malformed cursor is `invalid_request`, never 500.
- **S5.** `block` and `mute` resolve the target through the visibility rule (`not_found` when the target blocked the viewer). `targetPost` evaluates the post's state before the block direction, so a blocker probing ids learns nothing about hidden posts.
- **S6.** Bodies, alt text, display names and bios reject bidirectional overrides and isolates (U+202A–U+202E, U+2066–U+2069), U+200B, U+2060 and U+FEFF; length counts exclude format characters; a body that is empty after removing them is rejected.
- **S7.** Follower and following queries filter blocks before `LIMIT`.
- **S8.** When the rate-limit store fails, writes and the global limiter answer `503 service_unavailable` with `Retry-After: 30`, logged once per outage.
- **S9.** `PostId` and other id schemas lowercase their input.
- **M8.** Uploads gain a daily cap per account: 60 in the first 24 hours, 500 afterwards.
- **Indexes** by migration: `posts (reply_to_id, created_at, id)`; `follows (followee_id, created_at, follower_id)` and `(follower_id, created_at, followee_id)`; a partial `posts (created_at, id) where reply_to_id is null and state = 'visible'` for Latest. The Following timeline applies the cursor and limit inside each `UNION ALL` branch.

## 7. Web client (Task 7)

- **W1, keyboard.** Every navigation control becomes a real anchor: expo-router `Link` (`asChild` where a Pressable's styling is kept) for the app shell, author lines, quote embeds, profile rows, stats, list headers and back links; `Text href` with `hrefAttrs={{ target: "_blank", rel: "noopener noreferrer" }}` for URLs in `RichText`; mentions through `Link`. The a11y test scans `src` and fails on any `accessibilityRole="link"` or `role="link"` outside a `Link` or without `href`, and renders `Text href` to prove the anchor attributes.
- **W3.** Delete asks "Delete this post?" inline with Delete and Keep; actions carry a busy flag while a request is in flight.
- **W4, W13.** `PagedList` keeps an in-flight ref and a request sequence; only the latest response commits; a failed first page shows a Try again button.
- **W5.** Session state gains `error` with a retry; `api()` reports any 401 outside the auth flow to the session provider, which flips to signed out.
- **W6, W7.** Post ids are validated with `PostId` and encoded before use; profile updates use functional `setProfile`.
- **W8.** Metadata text moves from zinc-500 to zinc-400; input borders to zinc-500; placeholders to zinc-400.
- **W9–W12.** Image cells are buttons; the compose sheet's backdrop is not a tab stop, its content is a plain view, its slide honours reduced motion, and the draft survives closing the sheet; re-authentication and block confirmation panels are `role="dialog"` with a labelled heading and initial focus; section headings get `aria-level={2}`; `accessibilityViewIsModal` goes; the clipboard call catches rejection.
- **W16.** `src/app/+html.tsx` adds `<meta name="color-scheme" content="dark">`, a dark body background and an inline SVG favicon; `/favicon.ico` no longer falls through to the app.
- **W15.** The terms' "Your data" section names Cloudflare Turnstile at sign-in and the per-browser device id.
- **Settings highlight.** The Settings link is current on every `/settings/*` page.

## 8. Infrastructure (Task 8)

- `postgres:18-alpine` (digest-pinned), volume `pgdata18:/var/lib/postgresql`. `scripts/pg-major-upgrade.mjs <compose project>`: runs `pg_dump -Fc` from a temporary `postgres:16-alpine` container on the old `pgdata` volume, starts the new service, restores with `pg_restore` as the superuser (roles exist from init), and prints the row counts of `profiles`, `posts` and `drizzle.__drizzle_migrations` before and after. The dry run upgrades the scratch stack with it; the replay upgrades the development stack. The old volume is not removed by the script.
- `valkey/valkey:9.1-alpine` with `--requirepass` from `REDIS_PASSWORD` (generated by `gen-dev-env`), `REDIS_URL` carries it, the health check uses `VALKEYCLI_AUTH`. AOF and `noeviction` stay.
- Caddy: image pinned, runs as a dedicated non-root user on port 8080 with `cap_drop: [ALL]`, read-only root; `admin off`; the security `header` block moves inside the SPA handle so `/api/*` keeps the API's own headers (M5/W14); `encode gzip` only for the SPA; `Cache-Control: no-cache` for `index.html` and `public, max-age=31536000, immutable` for `/_expo/*` and `/assets/*` (W2); `request_body max_size 64KB` for `/api/*` and 25MB for `POST /api/media`; `header_up -CF-Connecting-IP` under a `TUNNEL=off` build argument default, so a LAN deployment cannot be spoofed and the tunnel deployment keeps the header.
- Networks: `edge` (cloudflared, caddy), `app` (caddy, api), `data` (api, migrate, postgres, redis; mailpit in dev). The worker keeps `network_mode: none`.
- Limits: `mem_limit`/`memswap_limit` and `pids_limit` on api (512m, 256), caddy (128m, 64), postgres (1g, 256), redis (384m, 64); `logging: json-file, max-size 20m, max-file 5` on every service.
- cloudflared `2026.9.1`, Mailpit `v1.31.2`, semgrep `1.177.0`; Renovate extends `docker:pinDigests`; digests recorded for every image.
- Dockerfiles: `corepack enable && corepack install` from `packageManager: "pnpm@10.30.0+sha512.<hex>"` in the root `package.json`; CI keeps the pinned action with the same version.
- CI: `permissions: contents: read` on both jobs; a `docker` job runs `docker compose build` for the three images.
- Script guards: `smoke-auth-stack.mjs` and `clean-dev-fixtures.mjs` refuse a non-default `docker context`; `gen-dev-env.mjs` refuses when `API_APP_ORIGIN` in `infra/.env` is not a localhost origin.
- `.env.example` documents `API_TRUST_PROXY`, `REDIS_PASSWORD`, `MEDIA_RECONCILE`, `API_TOTP_ENC_KEYS_PREVIOUS`.

## 9. Documentation (Task 9)

README: dev quick start (Valkey, the password), tests, upgrading Postgres, restore rule for the sweeper, "Before going public" (proxy trust, tunnel build argument, Cloudflare cache header), the audit's accepted advisories. Main design section 9: this audit, the method change, the sub-project status and the order of what follows (1b, 1c, 2c, 3, 3b, 4, 5; Foundation Task 16 and the account-dependent steps at the end). 1a section 13 and 2a section 13 gain the amendments named above.

## 10. Deferred

- **Owner-scoped RLS** (M13, S11): every policy is `USING (true)`; scoping needs a per-transaction identity (`SET LOCAL`) in every repository, a cross-cutting change planned for sub-project 4 with the pen-test checklist.
- **Backups, alerting, disk-full handling, secrets files**: sub-project 4 (the restore rule and the upgrade script from this batch are its first pieces).
- **A nonce-based CSP** (W14): `style-src 'unsafe-inline'` is required by the export's reset style; revisit with the nonce support of the Turnstile component in sub-project 4.
- **NativeWind 5 / Tailwind 4, Expo SDK 58, vitest 5**: when stable and 7 days old (Renovate proposes them).
- **Removing reanimated from the web bundle, the light theme, per-screen document titles, a branded error boundary**: sub-project 2c (web polish) or 5.
- **Timing differences on known vs unknown emails** (A11): below the tested 50 ms threshold behind Turnstile and limits.
- **`uuid` 7 under Expo's Xcode plugin and `esbuild` 0.18 under drizzle-kit's loader**: build-time only; overriding could break those tools; Renovate will move them with their parents.

## 11. Testing

Unit tests first for every defect (auth flows with the memory store, logger, config guards, cursor schema, contracts' character rules, social visibility with the in-memory fixtures, the job runner with an injectable clock, the file layer with a FIFO, the web a11y and query-string tests). Integration tests for the social changes (blocks retracting reposts and likes, pair locks under `Promise.all`, follower pages, index migration applied), the janitor (rows purged, events purged through the function, `korbat_auth` still cannot delete directly), proxy trust through the HTTP client, ioredis 6 against Valkey. The full stack: `smoke-auth-stack.mjs` through Caddy on the upgraded Postgres 18 and Valkey, the worker isolation checks, the worst-case image mode after the sharp-unchanged build. The browser check on the scratch stack: keyboard-only navigation (Tab, Enter) through the shell, a post, a profile and a mention; the delete confirmation; a route with a query string; the favicon and dark background before the bundle loads.

## 12. Success criteria

- `pnpm typecheck`, `pnpm test`, the integration suite and both builds pass on TypeScript 7/6, esbuild, ioredis 6, hono 4.13.8 and zod 4.6.5; `pnpm audit --audit-level high` passes and the web-bundle advisory is gone (or recorded as accepted).
- The scratch stack runs on Postgres 18 and Valkey 9.1 after the upgrade script, with the smoke test green through Caddy on port 8080.
- Every finding rated High or Medium by the reviews (A1, A2, M1, M2, M3, M4, S1, S2, W1, W2, W3, W4, W5) has a test that failed before its fix and passes after.
- `docs/superpowers/prompts/audit-fixes/verify_prompts.py` reproduces the repository, and the replay's commits match the dry run's blob for blob outside migration names and lockfile variant noise.

## 13. Amendments from the dry run (2026-09-23 and 2026-09-24)

Found while the tasks were dry-run in the scratch clone; each is applied in the prompts.

- **The age check sits after the per-address limit and before the per-email cooldown (section 3, A11).** Section 3 said "after the rate limits"; behind the 60-second resend cooldown a second attempt with a blocked address would answer 429 for a minute instead of `age_requirement`, which the end-to-end test caught. The per-address limit (10 an hour) is what bounds probing.
- **Mutual blocks cannot arise (section 6, S5).** Since a block towards an account that blocks the viewer is `not_found`, two accounts can never both block each other one after the other, and the pair lock keeps a concurrent pair from landing both; the graph test therefore proves the undo rule with a mute placed before the other side's block, and with a plain block.
- **Valkey starts on a new volume `valkeydata` (section 8).** The rehearsal found that Valkey 9.1 refuses the append-only file Redis 7.4 left in `redisdata` (`Can't handle RDB format version 12`), so the stack would never come up on the old volume. Its contents were transient (rate-limit counters, sign-in codes in flight, cached sessions with Postgres as the source of truth, queued image jobs), so the service moves to a fresh volume and the old one can be removed by hand, like the PostgreSQL 16 volume.
- **The API's `NODE_ENV` in Compose follows `KORBAT_ENV` (section 8).** With Task 4's production guards, an API fixed at `NODE_ENV: production` refused the development stack's Turnstile test secret and plain-http origins, so it never became healthy. `KORBAT_ENV` (development or production, required, no default) is now both the web image's build argument and the API's `NODE_ENV`; the worker keeps running as production, since its only guard is the libvips block list every stack sets.
- **The browser rule counts Origin, Sec-Fetch-Site or Sec-Fetch-Dest, not Sec-Fetch-Mode (section 3, applied in Task 8).** Node's fetch always sends `Sec-Fetch-Mode: cors` and cannot drop it, so the stack's smoke test, a native-style client, was answered with cookies and no token. Browsers send Origin on every state change and the fetch metadata headers together, so those decide; a test proves a bare Sec-Fetch-Mode keeps its claimed platform.
```

## Step 2: verify: sections

```bash
grep -c 'Amendments from the audit (2026-09-23)' docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md docs/superpowers/specs/2026-09-18-images-2b-design.md && grep -c 'from the audit (`2026-09-23-audit-fixes-design.md`)' docs/superpowers/specs/2026-09-03-korbat-design.md && grep -c 'Amendments from the dry run' docs/superpowers/specs/2026-09-23-audit-fixes-design.md
```

Expected output contains:

- `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md:1`
- `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md:1`
- `docs/superpowers/specs/2026-09-18-images-2b-design.md:1`

Observed on the dry run:

```text
docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md:1
docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md:1
docs/superpowers/specs/2026-09-18-images-2b-design.md:1
```

## Step 3: verify: line-endings

```bash
python -c "import sys; bad=[f for f in sys.argv[1:] if b'\r' in open(f,'rb').read()]; print('crlf-files', bad)" docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md docs/superpowers/specs/2026-09-18-images-2b-design.md docs/superpowers/specs/2026-09-03-korbat-design.md docs/superpowers/specs/2026-09-23-audit-fixes-design.md
```

Expected output contains:

- `crlf-files []`

Observed on the dry run:

```text
crlf-files []
```

## Step 4: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `docs/superpowers/specs/2026-09-03-korbat-design.md`
- `docs/superpowers/specs/2026-09-14-identity-auth-1a-design.md`
- `docs/superpowers/specs/2026-09-17-posting-feed-2a-design.md`
- `docs/superpowers/specs/2026-09-18-images-2b-design.md`
- `docs/superpowers/specs/2026-09-23-audit-fixes-design.md`

## Step 5: commit

```bash
git add -A
git commit -q -m "docs: audit amendments in the 1a, 2a and 2b specs; the main design records the audit, the technology and method changes and the roadmap; the audit spec gains its dry-run amendments" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `docs: audit amendments in the 1a, 2a and 2b specs; the main design records the audit, the technology and method changes and the roadmap; the audit spec gains its dry-run amendments`.

## Report format (mandatory)

```text
TASK 9 REPORT
Files written: <count, expected 5>
Verify "sections": <paste the expected lines as printed>
Verify "line-endings": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
