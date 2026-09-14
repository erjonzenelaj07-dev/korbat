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
